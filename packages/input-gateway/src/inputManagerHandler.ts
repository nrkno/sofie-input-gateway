import * as Winston from 'winston'
import { StatusCode } from '@sofie-automation/shared-lib/dist/lib/status'
import { CoreHandler } from './coreHandler'
import { DeviceSettings } from './interfaces'
import { PeripheralDeviceId } from '@sofie-automation/shared-lib/dist/core/model/Ids'
import { Process } from './process'
import { Config } from './connector'
import { InputManager, TriggerEventArgs, DeviceType } from '@sofie-automation/input-manager'
import { SendQueue } from './sendQueue'
import { DeviceTriggerMountedAction, PreviewWrappedAdLib } from './lib/coreInterfaces'

export type SetProcessState = (processName: string, comments: string[], status: StatusCode) => void

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
export class InputManagerHandler {
	#coreHandler!: CoreHandler
	#config!: Config
	#logger: Winston.Logger
	#process!: Process

	#inputManager: InputManager | undefined
	#queue: SendQueue

	constructor(logger: Winston.Logger) {
		this.#logger = logger
		this.#queue = new SendQueue()
	}

	async init(config: Config): Promise<void> {
		this.#config = config

		try {
			this.#logger.info('Initializing Process...')
			this.initProcess()
			this.#logger.info('Process initialized')

			this.#logger.info('Initializing Core...')
			await this.initCore()
			this.#logger.info('Core initialized')

			const peripheralDevice = await this.#coreHandler.core.getPeripheralDevice()

			// Stop here if studioId not set
			if (!peripheralDevice.studioId) {
				this.#logger.warn('------------------------------------------------------')
				this.#logger.warn('Not setup yet, exiting process!')
				this.#logger.warn('To setup, go into Core and add this device to a Studio')
				this.#logger.warn('------------------------------------------------------')
				// eslint-disable-next-line no-process-exit
				process.exit(1)
				return
			}
			this.#logger.info('Initializing InputManager...')

			await this.initInputManager(peripheralDevice.settings || {})
			this.#logger.info('InputManager initialized')

			this.#logger.info('Initialization done')
			return
		} catch (e) {
			this.#logger.error('Error during initialization:')
			this.#logger.error(e)
			if (e instanceof Error) this.#logger.error(e.stack)
			try {
				if (this.#coreHandler) {
					this.#coreHandler.destroy().catch(this.#logger.error)
				}
			} catch (e1) {
				this.#logger.error(e1)
			}
			this.#logger.info('Shutting down in 10 seconds!')
			setTimeout(() => {
				// eslint-disable-next-line no-process-exit
				process.exit(0)
			}, 10 * 1000)
			return
		}
	}
	initProcess(): void {
		this.#process = new Process(this.#logger)
		this.#process.init(this.#config.process)
	}
	async initCore(): Promise<void> {
		this.#coreHandler = new CoreHandler(this.#logger, this.#config.device)
		await this.#coreHandler.init(this.#config.core, this.#process)
	}

	async initInputManager(settings: DeviceSettings): Promise<void> {
		this.#logger.info('Initializing Input Manager with the following settings:')

		this.#logger.info(JSON.stringify(settings))

		let currentSettngs = JSON.stringify(settings)

		// TODO: Initialize input Manager

		this.#inputManager = await this.#createInputManager()

		let devicesPreviewId = await this.#coreHandler.core.autoSubscribe(
			'mountedTriggersForDevice',
			this.#coreHandler.core.deviceId,
			['midi0', 'http0', 'streamDeck0']
		)
		await this.#coreHandler.core.autoSubscribe('mountedTriggersForDevicePreview', this.#coreHandler.core.deviceId)

		this.#logger.info(`Subscribed to mountedTriggersForDevice: ${devicesPreviewId}`)

		this.#coreHandler.core
			.getCollection('mountedTriggers')
			.find({})
			.forEach((obj) => {
				const mountedTrigger = obj as DeviceTriggerMountedAction
				this.#handleChangedMountedTrigger(mountedTrigger._id).catch(this.#logger.error)
			})

		const observer0 = this.#coreHandler.core.observe('mountedTriggers')
		observer0.added = (id, _obj) => {
			this.#handleChangedMountedTrigger(id).catch(this.#logger.error)
		}
		observer0.changed = (
			id,
			oldFields: Partial<DeviceTriggerMountedAction>,
			cleared: string[],
			newFields: Partial<DeviceTriggerMountedAction>
		) => {
			const obj = this.#coreHandler.core.getCollection('mountedTriggers').findOne(id) as DeviceTriggerMountedAction
			if (
				newFields['deviceId'] ||
				newFields['deviceTriggerId'] ||
				cleared.includes('deviceId') ||
				cleared.includes('deviceTriggerId')
			) {
				this.#handleRemovedMountedTrigger(
					oldFields.deviceId ?? obj.deviceId,
					oldFields.deviceTriggerId ?? obj.deviceTriggerId
				)
					.then(async () => this.#handleChangedMountedTrigger(id))
					.catch(this.#logger.error)
			}
		}
		observer0.removed = (_id, obj) => {
			const obj0 = obj as any as DeviceTriggerMountedAction
			this.#handleRemovedMountedTrigger(obj0.deviceId, obj0.deviceTriggerId).catch(this.#logger.error)
		}
		const observer1 = this.#coreHandler.core.observe('mountedTriggersPreviews')
		observer1.added = (id, obj) => {
			const changedPreview = obj as PreviewWrappedAdLib
			const mountedAction = this.#coreHandler.core.getCollection('mountedTriggers').findOne({
				actionId: changedPreview.actionId,
			}) as DeviceTriggerMountedAction | undefined
			if (!mountedAction) {
				this.#logger.error(`Could not find mounted action for PreviewAdlib: "${id}"`)
				return
			}
			this.#handleChangedMountedTrigger(mountedAction._id).catch(this.#logger.error)
		}
		observer1.changed = (id, _old, _cleared, _new) => {
			const obj = this.#coreHandler.core.getCollection('mountedTriggersPreviews').findOne(id)
			if (!obj) {
				this.#logger.error(`Could not find PreviewAdlib: "${id}"`)
				return
			}
			const changedPreview = obj as PreviewWrappedAdLib
			const mountedAction = this.#coreHandler.core.getCollection('mountedTriggers').findOne({
				actionId: changedPreview.actionId,
			}) as DeviceTriggerMountedAction | undefined
			if (!mountedAction) {
				this.#logger.error(`Could not find mounted action for PreviewAdlib: "${changedPreview._id}"`)
				return
			}
			this.#handleChangedMountedTrigger(mountedAction._id).catch(this.#logger.error)
		}
		observer1.removed = (_id, obj) => {
			const changedPreview = obj as PreviewWrappedAdLib
			const mountedAction = this.#coreHandler.core.getCollection('mountedTriggers').findOne({
				actionId: changedPreview.actionId,
			}) as DeviceTriggerMountedAction | undefined
			if (!mountedAction) {
				this.#logger.error(`Could not find mounted action for PreviewAdlib: "${changedPreview._id}"`)
				return
			}
			this.#handleChangedMountedTrigger(mountedAction._id).catch(this.#logger.error)
		}

		// Monitor for changes in settings:
		this.#coreHandler.onChanged(() => {
			this.#logger.debug(`Device configuration changed`)

			this.#coreHandler.core
				.getPeripheralDevice()
				.then(async (device) => {
					if (device) {
						if (JSON.stringify(device.settings || {}) === currentSettngs) return

						if (this.#inputManager) {
							await this.#inputManager.destroy()
							this.#inputManager = undefined
						}

						this.#coreHandler.core.unsubscribe(devicesPreviewId)

						currentSettngs = JSON.stringify(device.settings || {})

						this.#inputManager = await this.#createInputManager()

						devicesPreviewId = await this.#coreHandler.core.autoSubscribe(
							'mountedTriggersForDevice',
							this.#coreHandler.core.deviceId,
							['midi0', 'http0', 'streamDeck0']
						)
					}
				})
				.catch(() => {
					this.#logger.error(`coreHandler.onChanged: Could not get peripheral device`)
				})
		})
	}

	#throttleSendTrigger(
		deviceId: string,
		triggerId: string,
		args: Record<string, string | number | boolean> | undefined,
		replacesUnsent: boolean
	) {
		const className = `${deviceId}_${triggerId}`
		if (replacesUnsent) this.#queue.remove(className)
		this.#queue
			.add(
				async () =>
					this.#coreHandler.core.callMethod('peripheralDevice.input.trigger', [deviceId, triggerId, args ?? null]),
				{
					className,
				}
			)
			.catch(() => {
				this.#logger.error(`peripheralDevice.input.trigger failed`)
			})
	}

	async #createInputManager(): Promise<InputManager> {
		const manager = new InputManager(
			{
				devices: {
					midi0: {
						type: DeviceType.MIDI,
						options: {
							inputName: 'X-TOUCH MINI',
						},
					},
					http0: {
						type: DeviceType.HTTP,
						options: {
							port: 9090,
						},
					},
					streamDeck0: {
						type: DeviceType.STREAM_DECK,
						options: {
							device: {
								index: 0,
							},
						},
					},
				},
			},
			this.#logger
		)
		manager.on('trigger', (e: TriggerEventArgs) => {
			this.#throttleSendTrigger(e.deviceId, e.triggerId, e.arguments, e.replacesPrevious ?? false)
		})

		this.#logger.debug(`Created observers for mountedTriggers and mountedTriggersPreviews`)

		await manager.init()
		return manager
	}

	async #handleChangedMountedTrigger(id: string): Promise<void> {
		const obj = this.#coreHandler.core.getCollection('mountedTriggers').findOne(id)
		if (!this.#inputManager) return

		const mountedTrigger = obj as DeviceTriggerMountedAction | undefined

		const feedbackDeviceId = mountedTrigger?.deviceId
		const feedbackTriggerId = mountedTrigger?.deviceTriggerId
		this.#logger.debug(`Setting feedback for "${feedbackDeviceId}", "${feedbackTriggerId}"`)
		if (!feedbackDeviceId || !feedbackTriggerId) return

		const actionId = mountedTrigger?.actionId

		let contentLabel: string | undefined
		if (actionId) {
			const previewedAdlibs = this.#coreHandler.core.getCollection('mountedTriggersPreviews').find({
				actionId: mountedTrigger?.actionId,
			}) as PreviewWrappedAdLib[]
			contentLabel = previewedAdlibs.map((adlib) => JSON.stringify(adlib.label)).join(', ')
		}

		await this.#inputManager.setFeedback(feedbackDeviceId, feedbackTriggerId, {
			action: mountedTrigger ? { long: mountedTrigger.actionType } : undefined,
			content: contentLabel ? { long: contentLabel } : undefined,
		})
	}

	async #handleRemovedMountedTrigger(deviceId: string, triggerId: string): Promise<void> {
		if (!this.#inputManager) return

		const feedbackDeviceId = deviceId
		const feedbackTriggerId = triggerId
		this.#logger.debug(`Removing feedback for "${feedbackDeviceId}", "${feedbackTriggerId}"`)
		if (!feedbackDeviceId || !feedbackTriggerId) return

		await this.#inputManager.setFeedback(feedbackDeviceId, feedbackTriggerId, null)
	}
}