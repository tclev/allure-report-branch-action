import type { context } from '@actions/github'
import * as child_process from 'child_process'
import * as fs from 'fs/promises'

export const isExists = async (path: string) => {
	try {
		await fs.access(path, 0)
		return true
	} catch (err) {
		return false
	}
}

export const normalizeBranchName = (branchName: string) => branchName.replaceAll('/', '_').replaceAll('.', '_')

export const getBranchName = (gitRef: string, pull_request?: (typeof context)['payload']) => {
	const branchName: string = pull_request ? pull_request.head.ref : gitRef.replace('refs/heads/', '')
	return normalizeBranchName(branchName)
}

const logError = (err: unknown, output: string[]) => {
	console.log(output.join(''))
	return err
}

export const spawnProcess = async (command: string, args: string[], cwd?: string) => {
	const childProcess = child_process.spawn(command, args, { cwd })
	return new Promise<string>((resolve, reject) => {
		const output: string[] = []
		const r1 = childProcess.stdout?.on('data', (d) => output.push(d.toString()))
		const r2 = childProcess.stderr?.on('data', (d) => output.push(d.toString()))

		const p1 = new Promise<void>((resolve) => (r1 ? r1.once('close', resolve) : resolve()))
		const p2 = new Promise<void>((resolve) => (r2 ? r2.once('close', resolve) : resolve()))

		childProcess.once('error', (err) => reject(logError(err, output)))
		childProcess.once('exit', async (code: unknown) => {
			r1?.removeAllListeners('data')
			r2?.removeAllListeners('data')
			await p1
			await p2
			return code === 0 ? resolve(output.join('')) : reject(logError(code, output))
		})
	})
}
