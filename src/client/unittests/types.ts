// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

// tslint:disable-next-line:ordered-imports
import {
    DiagnosticSeverity, Disposable, DocumentSymbolProvider,
    Event, Location, ProviderResult, TextDocument,
    TreeDataProvider, Uri
} from 'vscode';
import { Product } from '../common/types';
import { CommandSource } from './common/constants';
import {
    FlattenedTestFunction, ITestManager, ITestResultsService,
    TestFile, TestFolder, TestFunction, TestRunOptions, Tests,
    TestStatus, TestsToRun, TestSuite, UnitTestProduct
} from './common/types';
import { TestTreeItem } from './explorer/testTreeViewItem';

export const IUnitTestConfigurationService = Symbol('IUnitTestConfigurationService');
export interface IUnitTestConfigurationService {
    displayTestFrameworkError(wkspace: Uri): Promise<void>;
    selectTestRunner(placeHolderMessage: string): Promise<UnitTestProduct | undefined>;
    enableTest(wkspace: Uri, product: UnitTestProduct): Promise<void>;
    promptToEnableAndConfigureTestFramework(wkspace: Uri): Promise<void>;
}

export const ITestResultDisplay = Symbol('ITestResultDisplay');

export interface ITestResultDisplay extends Disposable {
    enabled: boolean;
    readonly onDidChange: Event<void>;
    displayProgressStatus(testRunResult: Promise<Tests>, debug?: boolean): void;
    displayDiscoverStatus(testDiscovery: Promise<Tests>, quietMode?: boolean): Promise<Tests>;
}

export const ITestDisplay = Symbol('ITestDisplay');
export interface ITestDisplay {
    displayStopTestUI(workspace: Uri, message: string): void;
    displayTestUI(cmdSource: CommandSource, wkspace: Uri): void;
    selectTestFunction(rootDirectory: string, tests: Tests): Promise<FlattenedTestFunction>;
    selectTestFile(rootDirectory: string, tests: Tests): Promise<TestFile>;
    displayFunctionTestPickerUI(cmdSource: CommandSource, wkspace: Uri, rootDirectory: string, file: Uri, testFunctions: TestFunction[], debug?: boolean): void;
}

export const IUnitTestManagementService = Symbol('IUnitTestManagementService');
export interface IUnitTestManagementService {
    readonly onDidStatusChange: Event<WorkspaceTestStatus>;
    activate(symbolProvider: DocumentSymbolProvider): Promise<void>;
    getTestManager(displayTestNotConfiguredMessage: boolean, resource?: Uri): Promise<ITestManager | undefined | void>;
    discoverTestsForDocument(doc: TextDocument): Promise<void>;
    autoDiscoverTests(): Promise<void>;
    discoverTests(cmdSource: CommandSource, resource?: Uri, ignoreCache?: boolean, userInitiated?: boolean, quietMode?: boolean): Promise<void>;
    stopTests(resource: Uri): Promise<void>;
    displayStopUI(message: string): Promise<void>;
    displayUI(cmdSource: CommandSource): Promise<void>;
    displayPickerUI(cmdSource: CommandSource, file: Uri, testFunctions: TestFunction[], debug?: boolean): Promise<void>;
    runTestsImpl(cmdSource: CommandSource, resource?: Uri, testsToRun?: TestsToRun, runFailedTests?: boolean, debug?: boolean): Promise<void>;
    runCurrentTestFile(cmdSource: CommandSource): Promise<void>;

    selectAndRunTestFile(cmdSource: CommandSource): Promise<void>;

    selectAndRunTestMethod(cmdSource: CommandSource, resource: Uri, debug?: boolean): Promise<void>;

    viewOutput(cmdSource: CommandSource): void;
}

export const ITestConfigSettingsService = Symbol('ITestConfigSettingsService');
export interface ITestConfigSettingsService {
    updateTestArgs(testDirectory: string | Uri, product: UnitTestProduct, args: string[]): Promise<void>;
    enable(testDirectory: string | Uri, product: UnitTestProduct): Promise<void>;
    disable(testDirectory: string | Uri, product: UnitTestProduct): Promise<void>;
}

export interface ITestConfigurationManager {
    requiresUserToConfigure(wkspace: Uri): Promise<boolean>;
    configure(wkspace: Uri): Promise<void>;
    enable(): Promise<void>;
    disable(): Promise<void>;
}

export const ITestConfigurationManagerFactory = Symbol('ITestConfigurationManagerFactory');
export interface ITestConfigurationManagerFactory {
    create(wkspace: Uri, product: Product, cfg?: ITestConfigSettingsService): ITestConfigurationManager;
}

export enum TestFilter {
    removeTests = 'removeTests',
    discovery = 'discovery',
    runAll = 'runAll',
    runSpecific = 'runSpecific',
    debugAll = 'debugAll',
    debugSpecific = 'debugSpecific'
}
export const IArgumentsService = Symbol('IArgumentsService');
export interface IArgumentsService {
    getKnownOptions(): { withArgs: string[]; withoutArgs: string[] };
    getOptionValue(args: string[], option: string): string | string[] | undefined;
    filterArguments(args: string[], argumentToRemove: string[]): string[];
    // tslint:disable-next-line:unified-signatures
    filterArguments(args: string[], filter: TestFilter): string[];
    getTestFolders(args: string[]): string[];
}
export const IArgumentsHelper = Symbol('IArgumentsHelper');
export interface IArgumentsHelper {
    getOptionValues(args: string[], option: string): string | string[] | undefined;
    filterArguments(args: string[], optionsWithArguments?: string[], optionsWithoutArguments?: string[]): string[];
    getPositionalArguments(args: string[], optionsWithArguments?: string[], optionsWithoutArguments?: string[]): string[];
}

export const ITestManagerRunner = Symbol('ITestManagerRunner');
export interface ITestManagerRunner {
    runTest(testResultsService: ITestResultsService, options: TestRunOptions, testManager: ITestManager): Promise<Tests>;
}

export const IUnitTestHelper = Symbol('IUnitTestHelper');
export interface IUnitTestHelper {
    getStartDirectory(args: string[]): string;
    getIdsOfTestsToRun(tests: Tests, testsToRun: TestsToRun): string[];
}

export const IUnitTestDiagnosticService = Symbol('IUnitTestDiagnosticService');
export interface IUnitTestDiagnosticService {
    getMessagePrefix(status: TestStatus): string | undefined;
    getSeverity(unitTestSeverity: PythonUnitTestMessageSeverity): DiagnosticSeverity | undefined;
}

export interface IPythonUnitTestMessage {
    code: string | undefined;
    message?: string;
    severity: PythonUnitTestMessageSeverity;
    provider: string;
    traceback?: string;
    testTime: number;
    status: TestStatus;
    locationStack?: ILocationStackFrameDetails[];
    testFilePath: string;
}
export enum PythonUnitTestMessageSeverity {
    Error,
    Failure,
    Skip,
    Pass
}
export enum DiagnosticMessageType {
    Error,
    Fail,
    Skipped,
    Pass
}

export interface ILocationStackFrameDetails {
    location: Location;
    lineText: string;
}

export type WorkspaceTestStatus = { workspace: Uri; status: TestStatus };

export type TestDataItem = TestFolder | TestFile | TestSuite | TestFunction;

export const ITestTreeViewProvider = Symbol('ITestTreeViewProvider');
export interface ITestTreeViewProvider extends TreeDataProvider<TestDataItem> {
    onDidChangeTreeData: Event<TestDataItem | undefined>;
    getTreeItem(element: TestDataItem): Promise<TestTreeItem>;
    getChildren(element?: TestDataItem): ProviderResult<TestDataItem[]>;
}

export const ITestDataItemResource = Symbol('ITestDataItemResource');

export interface ITestDataItemResource {
    getResource(testData: Readonly<TestDataItem>): Uri;
}
