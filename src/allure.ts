import * as child_process from 'child_process'
import * as fs from 'fs/promises'
import * as path from 'path'
import { isExists } from './helpers.js'

export interface ReportGenerationIdInfo {
	gitHash: string
	runId: string
	runTimestamp: number
}

export const writeEnvironmentFile = async (sourceResultsDir: string, envInfo: Record<string, string>) => {
	const dataFile = path.join(sourceResultsDir, 'environment.properties')
	const dataStr = Object.entries(envInfo)
		.map(([key, value]) => `${key}=${value}`)
		.join('\n')
	await fs.writeFile(dataFile, dataStr)
}

export const writeExecutorJson = async (
	sourceResultsDir: string,
	{
		buildUrl,
		buildOrder,
		reportName,
		reportUrl,
		reportGenerationId,
	}: {
		buildUrl: string
		reportGenerationId: string
		buildOrder: number
		reportName: string
		reportUrl: string
	}
) => {
	const dataFile = path.join(sourceResultsDir, 'executor.json')
	const dataJson: AllureExecutor = {
		reportName,
		// type is required, otherwise allure fails with java.lang.NullPointerException
		type: 'github',
		// adds link to GitHub Actions Run
		name: 'GitHub Actions',
		buildName: `Run ${reportGenerationId}`,
		buildUrl,
		// required to open previous report in TREND
		reportUrl,
		buildOrder,
	}
	await fs.writeFile(dataFile, JSON.stringify(dataJson, null, 2))
}

export const spawnAllure = async (inputResultsDir: string, outputReportDir: string, singleFileMode: boolean = false) => {
	const fileModeOption = singleFileMode ? '--single-file' : ''
	const allureChildProcess = child_process.spawn(
		'/allure-commandline/bin/allure',
		['generate', '--clean', fileModeOption, inputResultsDir, '-o', outputReportDir],
		{ stdio: 'inherit' }
	)
	const generation = new Promise<void>((resolve, reject) => {
		allureChildProcess.once('error', reject)
		allureChildProcess.once('exit', (code: unknown) => (code === 0 ? resolve() : reject(code)))
	})

	return generation
}

export const getReportGenerationId = (info: ReportGenerationIdInfo): string => {
	return `${info.gitHash}_${info.runId}_${info.runTimestamp}`
}

export const getReportGenerationIdInfo = (reportGenerationId: string): ReportGenerationIdInfo => {
	const [gitHash, runId, runTimestampStr] = reportGenerationId.split('_')
	return {
		gitHash,
		runId,
		runTimestamp: parseInt(runTimestampStr),
	}
}

export const getPrevReportGenerationId = async (reportTypeDir: string, prevGitHash: string) => {
	const matchDirs: Record<string, string> = {}
	if (await isExists(reportTypeDir)) {
		const dirs = await fs.readdir(reportTypeDir, { withFileTypes: true })
		dirs.filter((dirent) => dirent.isDirectory()).forEach((dir) => {
			if (dir.name.startsWith(prevGitHash)) {
				const runTimestamp = getReportGenerationIdInfo(dir.name).runTimestamp
				matchDirs[runTimestamp] = dir.name
			}
		})
		const hasPrevRunDirs = Object.keys(matchDirs).length > 0
		if (hasPrevRunDirs) {
			const prevRunTimestamp = Object.keys(matchDirs).sort().reverse()[0]
			return matchDirs[prevRunTimestamp]
		}
	}
	return null
}

export const writeRecordJson = async (reportDir: string, recordBase: AllureRecordBase) => {
	const summaryJson: AllureSummaryJson = JSON.parse(
		(await fs.readFile(path.join(reportDir, 'widgets', 'summary.json'))).toString('utf-8')
	)
	const filePath = path.join(reportDir, 'record.json')
	const failedTests = summaryJson.statistic.broken + summaryJson.statistic.failed
	const testResult: AllureRecordTestResult = failedTests > 0 ? 'FAIL' : summaryJson.statistic.passed > 0 ? 'PASS' : 'UNKNOWN'
	const record: AllureRecord = {
		...recordBase,
		testResult,
		summary: {
			statistic: summaryJson.statistic,
			time: summaryJson.time,
		},
	}
	await fs.writeFile(filePath, JSON.stringify(record, null, 2))

	return {
		testResult,
		passed: summaryJson.statistic.passed,
		failed: failedTests,
		total: summaryJson.statistic.total,
	}
}

export const getTestResultIcon = (testResult: AllureRecordTestResult) => {
	if (testResult === 'PASS') {
		return '✅'
	}
	if (testResult === 'FAIL') {
		return '❌'
	}
	return '❔'
}

export const isAllureResultsOk = async (sourceResultsDir: string) => {
	const allureResultExt = ['.json', '.xml']
	if (await isExists(sourceResultsDir)) {
		const listfiles = (await fs.readdir(sourceResultsDir, { withFileTypes: true })).filter((d) => {
			const fileName = d.name.toLowerCase()
			return d.isFile() && allureResultExt.some((ext) => fileName.endsWith(ext))
		})

		if (listfiles.length > 0) {
			return true
		}
		console.log('allure-results folder has no json or xml files:', sourceResultsDir)
		return false
	}
	console.log("allure-results folder doesn't exist:", sourceResultsDir)
	return false
}
