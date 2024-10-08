// @ts-check
import { glob } from 'glob'
import { exec } from 'child_process'
import readline from 'readline'
import { promisify } from 'util'

const execPromise = promisify(exec)

/*
This scripts signs all executables in the deploy/ folder with the certificate provided.
*/

const folderPath = 'deploy/'
const certificatePath = '.'

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
})

try {
	let signtoolInstalled = false
	try {
		await execPromise('where signtool')
		signtoolInstalled = true
	} catch (e) {
		signtoolInstalled = false
	}

	if (!signtoolInstalled) {
		console.log(
			'Warning: signtool is not installed. To enable signing of the resulting executables, install the Microsoft SDK for Windows 10 and add signtool.exe to your PATH.'
		)
		process.exit(0)
	}

	const executables = await glob(`${folderPath}/*.exe`)

	const certificates = await glob(`${certificatePath}/*.pfx`)

	if (certificates.length === 0) {
		console.log(
			'Warning: No certificates found. To sign the resulting executables, add one or more certificates (*.pfx file) to the base folder.'
		)
		process.exit(0)
	}
	if (executables.length === 0) {
		console.log(`Warning: No executables found in ${folderPath}`)
		process.exit(0)
	}

	console.log(`Found ${executables.length} executables`)
	console.log(`Found ${certificates.length} certificates`)

	let signedAny = false

	for (const certificate of certificates) {
		console.log(`\nSigning with certificate ${certificate}...`)

		const password = await new Promise((resolve) => {
			rl.question('Enter password for certificate: ', resolve)
		})

		if (!password) {
			console.log('No password provided, skipping...')
		} else {
			signedAny = true
			for (const executable of executables) {
				const e = await execPromise(
					`signtool sign /fd SHA256 /f ${certificate} ${password ? `/p ${password} ` : ''} ${executable}`
				)
				if (e.stderr) console.log(e.stderr)
				if (e.stdout) console.log(e.stdout)
			}
		}
	}

	if (signedAny) {
		console.log(`Done, signed ${executables.length} executables.`)
	} else {
		console.log(`Done, but didn't sign any executables.`)
	}

	process.exit(0)
} catch (e) {
	console.error(e)
	process.exit(1)
}
