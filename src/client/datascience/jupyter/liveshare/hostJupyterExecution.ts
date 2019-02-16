// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
'use strict';
import '../../../common/extensions';

import * as os from 'os';
import * as path from 'path';
import * as uuid from 'uuid/v4';
import { CancellationToken, Disposable } from 'vscode';
import * as vsls from 'vsls/vscode';

import { ILiveShareApi, IWorkspaceService } from '../../../common/application/types';
import { IFileSystem } from '../../../common/platform/types';
import { IProcessServiceFactory, IPythonExecutionFactory } from '../../../common/process/types';
import { IAsyncDisposableRegistry, IConfigurationService, IDisposableRegistry, ILogger } from '../../../common/types';
import * as localize from '../../../common/utils/localize';
import { noop } from '../../../common/utils/misc';
import { IInterpreterService, IKnownSearchPathsForInterpreters } from '../../../interpreter/contracts';
import { IServiceContainer } from '../../../ioc/types';
import { LiveShare, LiveShareCommands, RegExpValues } from '../../constants';
import {
    IConnection,
    IJupyterCommandFactory,
    IJupyterExecution,
    IJupyterSessionManager,
    INotebookServer,
    INotebookServerOptions
} from '../../types';
import { JupyterExecutionBase } from '../jupyterExecution';
import { LiveShareParticipantHost } from './liveShareParticipantMixin';
import { IRoleBasedObject } from './roleBasedFactory';

// tslint:disable:no-any

// This class is really just a wrapper around a jupyter execution that also provides a shared live share service
export class HostJupyterExecution
    extends LiveShareParticipantHost(JupyterExecutionBase, LiveShare.JupyterExecutionService)
    implements IRoleBasedObject, IJupyterExecution {
    private sharedServers: Disposable [] = [];
    private fowardedPorts: number [] = [];
    private serverCache : Map<string, INotebookServer> = new Map<string, INotebookServer>();
    private emptyKey = uuid();
    constructor(
        liveShare: ILiveShareApi,
        executionFactory: IPythonExecutionFactory,
        interpreterService: IInterpreterService,
        processServiceFactory: IProcessServiceFactory,
        knownSearchPaths: IKnownSearchPathsForInterpreters,
        logger: ILogger,
        disposableRegistry: IDisposableRegistry,
        asyncRegistry: IAsyncDisposableRegistry,
        private fileSys: IFileSystem,
        sessionManager: IJupyterSessionManager,
        private workspace: IWorkspaceService,
        private configService: IConfigurationService,
        commandFactory : IJupyterCommandFactory,
        serviceContainer: IServiceContainer) {
        super(
            liveShare,
            executionFactory,
            interpreterService,
            processServiceFactory,
            knownSearchPaths,
            logger,
            disposableRegistry,
            asyncRegistry,
            fileSys,
            sessionManager,
            workspace,
            configService,
            commandFactory,
            serviceContainer);
    }

    public async dispose() : Promise<void> {
        await super.dispose();
        const api = await this.api;
        await this.onDetach(api);
        this.fowardedPorts = [];
        // Dispose of all of our cached servers
        for (let [k, s] of this.serverCache) {
            await s.dispose();
        }
    }

    public async connectToNotebookServer(options?: INotebookServerOptions, cancelToken?: CancellationToken): Promise<INotebookServer | undefined> {
        // See if we have this server in our cache already or not
        const fixedOptions = await this.generateDefaultOptions(options);
        const key = this.generateServerKey(fixedOptions);
        if (this.serverCache.has(key)) {
            return this.serverCache.get(key);
        } else {
            // Create the server
            let sharedServerDisposable: Disposable | undefined;
            let port = -1;
            const result = await super.connectToNotebookServer(fixedOptions, cancelToken);

            // Then using the liveshare api, port forward whatever port is being used by the server

            // tslint:disable-next-line:no-suspicious-comment
            // TODO: Liveshare can actually change this value on the guest. So on the guest side we need to listen
            // to an event they are going to add to their api
            if (result) {
                const connectionInfo = result.getConnectionInfo();
                if (connectionInfo && connectionInfo.localLaunch) {
                    const portMatch = RegExpValues.ExtractPortRegex.exec(connectionInfo.baseUrl);
                    if (portMatch && portMatch.length > 1) {
                        port = parseInt(portMatch[1], 10);
                        sharedServerDisposable = await this.portForwardServer(port);
                    }
                }
            }

            if (result) {
                this.serverCache.set(key, result);

                // Save this result, but modify its dispose such that we
                // can detach from the server when it goes away.
                const oldDispose = result.dispose.bind(result);
                result.dispose = () => {
                    this.fowardedPorts = this.fowardedPorts.filter(p => p != port);
                    // Dispose of the shared server
                    if (sharedServerDisposable) {
                        sharedServerDisposable.dispose();
                    }
                    this.serverCache.delete(key);
                    return oldDispose();
                };
            }
            return result;
        }
    }

    public async onAttach(api: vsls.LiveShare | null) : Promise<void> {
        if (api) {
            const service = await this.waitForService();

            // Register handlers for all of the supported remote calls
            if (service) {
                service.onRequest(LiveShareCommands.isNotebookSupported, this.onRemoteIsNotebookSupported);
                service.onRequest(LiveShareCommands.isImportSupported, this.onRemoteIsImportSupported);
                service.onRequest(LiveShareCommands.isKernelCreateSupported, this.onRemoteIsKernelCreateSupported);
                service.onRequest(LiveShareCommands.isKernelSpecSupported, this.onRemoteIsKernelSpecSupported);
                service.onRequest(LiveShareCommands.connectToNotebookServer, this.onRemoteConnectToNotebookServer);
                service.onRequest(LiveShareCommands.getUsableJupyterPython, this.onRemoteGetUsableJupyterPython);
            }

            // Port forward all of the servers that need it
            this.fowardedPorts.forEach(p => this.portForwardServer(p).ignoreErrors());
        }
    }

    public async onDetach(api: vsls.LiveShare | null) : Promise<void> {
        if (api) {
            await api.unshareService(LiveShare.JupyterExecutionService);
        }

        // Unshare all of our port forwarded servers
        this.sharedServers.forEach(s => s.dispose());
        this.sharedServers = [];
    }

    private async portForwardServer(port: number) : Promise<Disposable | undefined> {
        // Share this port with all guests if we are actively in a session. Otherwise save for when we are.
        let result : Disposable | undefined;
        const api = await this.api;
        if (api && api.session && api.session.role === vsls.Role.Host) {
            result = await api.shareServer({port, displayName: localize.DataScience.liveShareHostFormat().format(os.hostname())});
            this.sharedServers.push(result!);
        }

        // Save for reattaching if necessary later
        if (this.fowardedPorts.indexOf(port) === -1) {
            this.fowardedPorts.push(port);
        }

        return result;
    }

    private onRemoteIsNotebookSupported = (args: any[], cancellation: CancellationToken): Promise<any> => {
        // Just call local
        return this.isNotebookSupported(cancellation);
    }

    private onRemoteIsImportSupported = (args: any[], cancellation: CancellationToken): Promise<any> => {
        // Just call local
        return this.isImportSupported(cancellation);
    }

    private onRemoteIsKernelCreateSupported = (args: any[], cancellation: CancellationToken): Promise<any> => {
        // Just call local
        return this.isKernelCreateSupported(cancellation);
    }
    private onRemoteIsKernelSpecSupported = (args: any[], cancellation: CancellationToken): Promise<any> => {
        // Just call local
        return this.isKernelSpecSupported(cancellation);
    }

    private onRemoteConnectToNotebookServer = async (args: any[], cancellation: CancellationToken): Promise<IConnection | undefined> => {
        // Connect to the local server. THe local server should have started the port forwarding already
        const options = await this.generateDefaultOptions(args[0] as INotebookServerOptions | undefined);
        const localServer = await this.connectToNotebookServer(options, cancellation);

        // Extract the URI and token for the other side
        if (localServer) {
            // The other side should be using 'localhost' for anything it's port forwarding. That should just remap
            // on the guest side. However we need to eliminate the dispose method. Methods are not serializable
            const connectionInfo = localServer.getConnectionInfo();
            if (connectionInfo) {
                return { baseUrl: connectionInfo.baseUrl, token: connectionInfo.token, localLaunch: false, dispose: noop };
            }
        }
    }

    private onRemoteGetUsableJupyterPython = (args: any[], cancellation: CancellationToken): Promise<any> => {
        // Just call local
        return this.getUsableJupyterPython(cancellation);
    }

    private generateServerKey(options?: INotebookServerOptions) : string {
        if (!options) {
            return this.emptyKey;
        } else {
            // combine all the values together to make a unique key
            return options.purpose +
                (options.uri ? options.uri : '') +
                (options.useDefaultConfig ? 'true' : 'false') +
                (options.usingDarkTheme ? 'true' : 'false') + // Ideally we'd have different results for different themes. Not sure how to handle this.
                (options.workingDir);
        }
    }

    private async generateDefaultOptions(options? : INotebookServerOptions) : Promise<INotebookServerOptions> {
        return {
            uri: options ? options.uri : undefined,
            useDefaultConfig : options ? options.useDefaultConfig : true, // Default for this is true.
            usingDarkTheme : options ? options.usingDarkTheme : undefined,
            purpose : options ? options.purpose : uuid(),
            workingDir : options && options.workingDir ? options.workingDir : await this.calculateWorkingDirectory()
        }
    }

    private async calculateWorkingDirectory(): Promise<string | undefined> {
        let workingDir: string | undefined;
        // For a local launch calculate the working directory that we should switch into
        const settings = this.configService.getSettings();
        const fileRoot = settings.datascience.notebookFileRoot;

        // If we don't have a workspace open the notebookFileRoot seems to often have a random location in it (we use ${workspaceRoot} as default)
        // so only do this setting if we actually have a valid workspace open
        if (fileRoot && this.workspace.hasWorkspaceFolders) {
            const workspaceFolderPath = this.workspace.workspaceFolders![0].uri.fsPath;
            if (path.isAbsolute(fileRoot)) {
                if (await this.fileSys.directoryExists(fileRoot)) {
                    // User setting is absolute and exists, use it
                    workingDir = fileRoot;
                } else {
                    // User setting is absolute and doesn't exist, use workspace
                    workingDir = workspaceFolderPath;
                }
            } else {
                // fileRoot is a relative path, combine it with the workspace folder
                const combinedPath = path.join(workspaceFolderPath, fileRoot);
                if (await this.fileSys.directoryExists(combinedPath)) {
                    // combined path exists, use it
                    workingDir = combinedPath;
                } else {
                    // Combined path doesn't exist, use workspace
                    workingDir = workspaceFolderPath;
                }
            }
        }
        return workingDir;
    }

}
