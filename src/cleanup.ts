import { Dirent, readdirSync } from 'fs'
import * as fs from 'fs/promises'
import * as path from 'path'
import { getReportGenerationId, getReportGenerationIdInfo } from './allure.js'
import { isExists } from './helpers.js'

export const cleanupOutdatedReports = async (reportBaseDir: string, maxActiveReports: number) => {
	try {
		const dirs = await fs.readdir(reportBaseDir, { withFileTypes: true })
		const activeReportDirs = dirs.filter((dirent) => dirent.isDirectory()).filter((dir) => isActiveReport(dir))
		for (const reportDir of determineReportsToCleanup(activeReportDirs, maxActiveReports)) {
			await cleanupReport(reportDir)
		}
	} catch (err) {
		console.error('cleanup outdated reports failed.', err)
	}
}

const isActiveReport = (dir: Dirent): boolean => {
	const dirPath = path.join(dir.path, dir.name)
	const dirents = readdirSync(dirPath)
	return dirents.length > 2
}

const determineReportsToCleanup = (activeReportDirs: Dirent[], maxActiveReports: number): Dirent[] => {
	const sortedInfo = activeReportDirs.map((dir) => getReportGenerationIdInfo(dir.name)).sort((a, b) => b.runTimestamp - a.runTimestamp)
	const gitHashesToKeep = new Set<string>()
	const infoToKeep = []
	for (const info of sortedInfo) {
		if (!gitHashesToKeep.has(info.gitHash)) {
			gitHashesToKeep.add(info.gitHash)
			infoToKeep.push(info)
			if (infoToKeep.length >= maxActiveReports) {
				break
			}
		}
	}
	const reportIdsToKeep = infoToKeep.map(getReportGenerationId)
	return activeReportDirs.filter((dir) => !reportIdsToKeep.includes(dir.name))
}

const cleanupReport = async (reportDir: Dirent) => {
	const reportDirPath = path.join(reportDir.path, reportDir.name)
	console.log('Cleaning up report:', reportDirPath)
	const dirents = await fs.readdir(reportDirPath, { withFileTypes: true })
	for (const dirent of dirents) {
		if (dirent.isDirectory()) {
			const dirPath = path.join(dirent.path, dirent.name)
			await fs.rm(dirPath, { recursive: true })
		} else if (dirent.name !== 'record.json') {
			const filePath = path.join(dirent.path, dirent.name)
			await fs.rm(filePath)
		}
	}

	const recordFilePath = path.join(reportDirPath, 'record.json')
	if (await isExists(recordFilePath)) {
		const indexFilePath = path.join(reportDirPath, 'index.html')
		await fs.writeFile(indexFilePath, "<head><meta http-equiv='refresh' content='0; URL=./record.json'></head>\n")
	}
}
