import * as core from '@actions/core'
import * as github from '@actions/github'
import * as io from '@actions/io'
import * as path from 'path'
import {
    getPrevReportGenerationId,
    getTestResultIcon,
    isAllureResultsOk,
    spawnAllure,
    updateDataJson,
    writeEnviromentFile,
    writeExecutorJson,
} from './src/allure.js'
import { getBranchName, isExists } from './src/helpers.js'
import { cleanupOutdatedReports } from './src/cleanup.js'

const baseDir = 'test-reports'

try {
    const runTimestamp = Date.now()

    // vars
    const prevGitHash = core.getInput('prev_git_hash')
    const testResultsDir = core.getInput('report_dir') // TODO: maybe rename this?
    const ghPagesPath = core.getInput('gh_pages')
    const reportId = core.getInput('report_id')
    const listDirs = core.getInput('list_dirs') == 'true'
    const listDirsBranch = core.getInput('list_dirs_branch') == 'true'
    const branchCleanupEnabled = core.getInput('branch_cleanup_enabled') == 'true'
    const maxReports = parseInt(core.getInput('max_reports'), 10)
    // const token = core.getInput('token')
    const branchName = getBranchName(github.context.ref, github.context.payload.pull_request)
    const reportBaseDir = path.join(ghPagesPath, baseDir, reportId)

    /**
     * `runId` is unique but won't change on job re-run
     * `runNumber` is not unique and resets from time to time
     * that's why the `runTimestamp` is used to guarantee uniqueness
     */
    const reportGenerationId = `${github.context.sha}_${github.context.runId}_${runTimestamp}`
    const reportOutputDir = path.join(reportBaseDir, reportGenerationId)

    // urls
    const githubActionRunUrl = `https://github.com/${github.context.repo.owner}/${github.context.repo.repo}/actions/runs/${github.context.runId}`
    const ghPagesUrl = `https://${github.context.repo.owner}.github.io/${github.context.repo.repo}`
    const ghPagesBaseUrl = `${ghPagesUrl}/${baseDir}/${branchName}/${reportId}`.replaceAll(' ', '%20')
    const ghPagesReportUrl = `${ghPagesBaseUrl}/${reportGenerationId}`.replaceAll(' ', '%20')
    const prevReportGenerationId = await getPrevReportGenerationId(reportBaseDir, prevGitHash)

    // log
    console.log({
        prevGitHash,
        testResultsDir,
        ghPagesPath,
        reportId,
        reportGenerationId,
        prevReportGenerationId,
        ref: github.context.ref,
        repo: github.context.repo,
        branchName,
        reportBaseDir,
        reportOutputDir,
        listDirsBranch,
        ghPagesReportUrl,
        listDirs,
        branchCleanupEnabled,
        maxReports,
    })

    if (!(await isExists(ghPagesPath))) {
        throw new Error("Folder with gh-pages branch doesn't exist: " + ghPagesPath)
    }

    if (!(await isAllureResultsOk(testResultsDir))) {
        throw new Error('There were issues with the allure-results, see error above.')
    }

    await io.mkdirP(reportBaseDir)

    // process allure report
    if (prevReportGenerationId) {
        const prevHistoryDir = path.join(reportBaseDir, prevReportGenerationId, 'history')
        await io.cp(prevHistoryDir, testResultsDir, { recursive: true })
    }
    await writeExecutorJson(testResultsDir, {
        reportName: reportId,
        reportGenerationId,
        buildOrder: github.context.runId,
        buildUrl: githubActionRunUrl,
        reportUrl: ghPagesReportUrl,
    })
    await writeEnviromentFile(testResultsDir, {
        RunId: github.context.runId.toString(),
        ReportId: reportGenerationId,
        BranchName: branchName,
        CommitSha: github.context.sha,
    })
    await spawnAllure(testResultsDir, reportOutputDir)
    const results = await updateDataJson(reportOutputDir, reportGenerationId)
    await cleanupOutdatedReports(reportBaseDir, maxReports)

    // outputs
    core.setOutput('report_url', ghPagesReportUrl)
    core.setOutput('report_history_url', ghPagesBaseUrl)
    core.setOutput('test_result', results.testResult)
    core.setOutput('test_result_icon', getTestResultIcon(results.testResult))
    core.setOutput('test_result_passed', results.passed)
    core.setOutput('test_result_failed', results.failed)
    core.setOutput('test_result_total', results.total)
    core.setOutput('run_unique_id', reportGenerationId)
    core.setOutput('report_path', reportOutputDir)
} catch (error) {
    core.setFailed(error.message)
}
