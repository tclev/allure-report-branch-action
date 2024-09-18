import * as core from '@actions/core'
import * as github from '@actions/github'
import * as io from '@actions/io'
import * as path from 'path'
import {
	getPrevReportGenerationId,
	getTestResultIcon,
	isAllureResultsOk,
	spawnAllure,
	writeRecordJson,
	writeEnvironmentFile,
	writeExecutorJson,
} from './src/allure.js'
import { cleanupOutdatedReports } from './src/cleanup.js'
import { getBranchName, isExists } from './src/helpers.js'

try {
	const runTimestamp = Date.now()

	// vars
	const prevGitHash = core.getInput('prev_git_hash')
	const testResultsDir = core.getInput('results_dir')
	const ghPagesPath = core.getInput('gh_pages_path')
	const ghPagesUrl = core.getInput('gh_pages_url')
	const reportType = core.getInput('report_type')
	const maxReports = parseInt(core.getInput('max_reports').trim() || '0')
	const cleanupEnabled = maxReports > 0
	const branchName = getBranchName(github.context.ref, github.context.payload.pull_request)
	const reportGenerationId = `${github.context.sha}_${github.context.runId}_${runTimestamp}`
	const baseDir = github.context.repo.repo
	const reportTypeDir = path.join(ghPagesPath, baseDir, reportType)
	const reportOutputDir = path.join(reportTypeDir, reportGenerationId)

	// urls
	const githubActionRunUrl = `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}/actions/runs/${github.context.runId}`
	const ghPagesBaseUrl = `${ghPagesUrl}/${baseDir}/${reportType}`.replaceAll(' ', '%20')
	const ghPagesReportUrl = `${ghPagesBaseUrl}/${reportGenerationId}`.replaceAll(' ', '%20')
	const prevReportGenerationId = await getPrevReportGenerationId(reportTypeDir, prevGitHash)

	// log
	console.log({
		prevGitHash,
		testResultsDir,
		ghPagesPath,
		reportType,
		reportGenerationId,
		prevReportGenerationId,
		ref: github.context.ref,
		repo: github.context.repo,
		branchName,
		reportTypeDir,
		reportOutputDir,
		ghPagesReportUrl,
		maxReports,
	})

	if (!(await isExists(ghPagesPath))) {
		throw new Error("Folder with GitHub Pages files doesn't exist: " + ghPagesPath)
	}

	if (!(await isAllureResultsOk(testResultsDir))) {
		throw new Error('There were issues with the allure-results, see error above.')
	}

	await io.mkdirP(reportTypeDir)

	// process allure report
	if (prevReportGenerationId) {
		const prevHistoryDir = path.join(reportTypeDir, prevReportGenerationId, 'history')
		await io.cp(prevHistoryDir, testResultsDir, { recursive: true })
	}
	await writeExecutorJson(testResultsDir, {
		reportName: reportType,
		reportGenerationId,
		buildOrder: github.context.runId,
		buildUrl: githubActionRunUrl,
		reportUrl: ghPagesReportUrl,
	})
	await writeEnvironmentFile(testResultsDir, {
		GitRepo: github.context.repo.repo,
		BranchName: branchName,
		CommitHash: github.context.sha,
		RunId: github.context.runId.toString(),
		ReportId: reportGenerationId,
	})
	await spawnAllure(testResultsDir, reportOutputDir)
	const results = await writeRecordJson(reportOutputDir, {
		repoName: github.context.repo.repo,
		gitHash: github.context.sha,
		branchName,
		reportGenerationId,
	})
	if (cleanupEnabled) {
		await cleanupOutdatedReports(reportTypeDir, maxReports)
	}

	// outputs
	core.setOutput('report_url', ghPagesReportUrl)
	core.setOutput('test_result', results.testResult)
	core.setOutput('test_result_icon', getTestResultIcon(results.testResult))
	core.setOutput('test_result_passed', results.passed)
	core.setOutput('test_result_failed', results.failed)
	core.setOutput('test_result_total', results.total)
	core.setOutput('report_generation_id', reportGenerationId)
	core.setOutput('report_path', reportOutputDir)
} catch (error) {
	core.setFailed(error.message)
}
