import { CoreHandler, CoreConfig } from './coreHandler'
import { Logger } from 'winston'
import { Process } from './process'
import { PeripheralDeviceId } from '@sofie-automation/shared-lib/dist/core/model/Ids'

export interface Config {
	process: ProcessConfig
	device: DeviceConfig
	core: CoreConfig
}
export interface ProcessConfig {
	/** Will cause the Node applocation to blindly accept all certificates. Not recommenced unless in local, controlled networks. */
	unsafeSSL: boolean
	/** Paths to certificates to load, for SSL-connections */
	certificates: string[]
}
export interface DeviceConfig {
	deviceId: PeripheralDeviceId
	deviceToken: string
}
export class Connector {
	private coreHandler: CoreHandler | undefined
	private _logger: Logger
	private _process: Process | undefined

	constructor(logger: Logger) {
		this._logger = logger
	}

	public async init(config: Config): Promise<void> {
		try {
			this._logger.info('Initializing Process...')
			this._process = new Process(this._logger)
			this._process.init(config.process)
			this._logger.info('Process initialized')

			this._logger.info('Initializing Core...')
			this.coreHandler = new CoreHandler(this._logger, config.device)
			await this.coreHandler.init(config.core, this._process)
			this._logger.info('Core initialized')

			this._logger.info('Initialization done')
			return
		} catch (e: any) {
			this._logger.error('Error during initialization:')
			this._logger.error(e)
			this._logger.error(e.stack)

			if (this.coreHandler) {
				this.coreHandler.destroy().catch((err) => {
					this._logger.error(`Error when trying to destroy coreHandler after error: ${err}`)
				})
			}

			this._logger.info('Shutting down in 10 seconds!')
			setTimeout(() => {
				// eslint-disable-next-line no-process-exit
				process.exit(0)
			}, 10 * 1000)
			return
		}
	}
}
