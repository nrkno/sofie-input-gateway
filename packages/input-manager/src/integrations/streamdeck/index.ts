import { listStreamDecks, openStreamDeck, StreamDeck } from '@elgato-stream-deck/node'
import { Logger } from '../../logger'
import { Device } from '../../devices/device'
import { FeedbackStore } from '../../devices/feedbackStore'
import { DEFAULT_ANALOG_RATE_LIMIT, Symbols } from '../../lib'
import { BitmapFeedback, Feedback, SomeFeedback } from '../../feedback/feedback'
import { getBitmap } from '../../feedback/bitmap'
import { StreamDeckDeviceOptions, StreamdeckStylePreset } from '../../generated'

import DEVICE_OPTIONS from './$schemas/options.json'

export class StreamDeckDevice extends Device {
	private streamDeck: StreamDeck | undefined
	private config: StreamDeckDeviceOptions
	private feedbacks = new FeedbackStore()
	private isButtonDown: Record<string, boolean> = {}
	private BTN_SIZE: number | undefined = undefined
	private ENC_SIZE_WIDTH: number | undefined = undefined
	private ENC_SIZE_HEIGHT: number | undefined = undefined

	constructor(config: StreamDeckDeviceOptions, logger: Logger) {
		super(logger)
		this.config = config
	}

	init = async (): Promise<void> => {
		const allDevices = await listStreamDecks()
		const deviceInfo = allDevices.find((thisDevice, index) => {
			let match = true
			if (this.config.path && thisDevice.path !== this.config.path) match = false
			if (this.config.serialNumber && thisDevice.serialNumber !== this.config.serialNumber) match = false
			if (this.config.index && index !== this.config.index) match = false

			return match
		})
		if (!deviceInfo) throw new Error('Matching device not found')

		this.logger.debug(
			`Stream Deck: path: ${deviceInfo.path}, serialNumber: ${deviceInfo.serialNumber}, index: ${allDevices.indexOf(
				deviceInfo
			)}`
		)

		const device = await openStreamDeck(deviceInfo.path, {
			resetToLogoOnClose: true,
		})
		if (!device) throw new Error(`Could not open device: "${deviceInfo.path}"`)
		this.streamDeck = device
		this.BTN_SIZE = this.streamDeck.ICON_SIZE
		this.ENC_SIZE_HEIGHT = this.streamDeck.LCD_ENCODER_SIZE?.height
		this.ENC_SIZE_WIDTH = this.streamDeck.LCD_ENCODER_SIZE?.width

		const brightness = this.config.brightness ?? DEFAULT_BRIGHTNESS

		this.streamDeck.setBrightness(brightness).catch((err) => {
			this.logger.error(`Error setting brightness: ${err}`, err)
		})
		this.streamDeck.addListener('down', (key) => {
			const id = `${key}`
			const triggerId = `${id} ${Symbols.DOWN}`

			this.addTriggerEvent({ triggerId })

			this.isButtonDown[id] = true

			this.quietUpdateFeedbackWithDownState(id)
		})
		this.streamDeck.addListener('up', (key) => {
			const id = `${key}`
			const triggerId = `${id} ${Symbols.UP}`

			this.addTriggerEvent({ triggerId })

			this.isButtonDown[id] = false

			this.quietUpdateFeedbackWithDownState(id)
		})
		this.streamDeck.addListener('encoderDown', (encoder) => {
			const id = `Enc${encoder}`
			const triggerId = `${id} ${Symbols.DOWN}`

			this.addTriggerEvent({ triggerId })

			this.isButtonDown[id] = true

			this.quietUpdateFeedbackWithDownState(id)
		})
		this.streamDeck.addListener('encoderUp', (encoder) => {
			const id = `Enc${encoder}`
			const triggerId = `${id} ${Symbols.UP}`

			this.addTriggerEvent({ triggerId })

			this.isButtonDown[id] = false

			this.quietUpdateFeedbackWithDownState(id)
		})
		this.streamDeck.addListener('rotateLeft', (encoder, deltaValue) => {
			const id = `Enc${encoder}`
			const triggerId = `${id} ${Symbols.JOG}`

			this.updateTriggerAnalog({ triggerId, rateLimit: DEFAULT_ANALOG_RATE_LIMIT }, (prev?: { deltaValue: number }) => {
				if (!prev) prev = { deltaValue: 0 }
				return {
					deltaValue: prev.deltaValue - deltaValue,
					direction: -1,
				}
			})

			this.quietUpdateFeedbackWithDownState(id)
		})
		this.streamDeck.addListener('rotateRight', (encoder, deltaValue) => {
			const id = `Enc${encoder}`
			const triggerId = `${id} ${Symbols.JOG}`

			this.updateTriggerAnalog({ triggerId, rateLimit: DEFAULT_ANALOG_RATE_LIMIT }, (prev?: { deltaValue: number }) => {
				if (!prev) prev = { deltaValue: 0 }
				return {
					deltaValue: prev.deltaValue + deltaValue,
					direction: 1,
				}
			})

			this.quietUpdateFeedbackWithDownState(id)
		})
		this.streamDeck.addListener('lcdShortPress', (encoder, position) => {
			const id = `Enc${encoder}`
			const triggerId = `${id} Tap`

			this.addTriggerEvent({
				triggerId,
				arguments: {
					xPosition: position.x,
					yPosition: position.y,
				},
			})

			this.quietUpdateFeedbackWithDownState(id)
		})
		this.streamDeck.addListener('lcdLongPress', (encoder, position) => {
			const id = `Enc${encoder}`
			const triggerId = `${id} Press`

			this.addTriggerEvent({
				triggerId,
				arguments: {
					xPosition: position.x,
					yPosition: position.y,
				},
			})

			this.quietUpdateFeedbackWithDownState(id)
		})
		this.streamDeck.addListener('lcdSwipe', (fromEncoder, toEncoder, from, to) => {
			const id = `Enc${fromEncoder}`
			const triggerId = `${id} Swipe`

			this.addTriggerEvent({
				triggerId,
				arguments: {
					fromEncoder,
					toEncoder,
					fromXPosition: from.x,
					fromYPosition: from.y,
					toXPosition: to.x,
					toYPosition: to.y,
				},
			})

			this.quietUpdateFeedbackWithDownState(id)
		})
		this.streamDeck.addListener('error', (err) => {
			this.logger.error(String(err))
			this.emit('error', { error: err instanceof Error ? err : new Error(String(err)) })
		})
		await this.streamDeck.clearPanel()
	}

	destroy = async (): Promise<void> => {
		await super.destroy()
		if (!this.streamDeck) return
		await this.streamDeck.close()
	}

	private static parseTriggerId(triggerId: string): {
		id: string
		key: number | undefined
		encoder: number | undefined
		action: string
	} {
		const triggerElements = triggerId.split(/\s+/)
		const id = triggerElements[0] ?? '0'
		const action = triggerElements[1] ?? ''
		let key: number | undefined = undefined
		let encoder: number | undefined = undefined
		let result = null
		if ((result = id.match(/^Enc(\d+)$/))) {
			encoder = Number(result[1]) ?? 0
			return { id, key, encoder, action }
		}
		key = Number(id) ?? 0
		return { id, key, encoder, action }
	}

	private updateFeedback = async (trigger: string, isDown: boolean): Promise<void> => {
		const streamdeck = this.streamDeck
		if (!streamdeck) return

		const { id, key, encoder } = StreamDeckDevice.parseTriggerId(trigger)

		const feedback = this.feedbacks.get(id, ACTION_PRIORITIES)

		try {
			if (!feedback) {
				if (key !== undefined) await streamdeck.clearKey(key)
				if (encoder !== undefined && this.ENC_SIZE_HEIGHT && this.ENC_SIZE_WIDTH) {
					const imgBuffer = await getBitmap(null, this.ENC_SIZE_WIDTH, this.ENC_SIZE_HEIGHT, false)
					await streamdeck.fillEncoderLcd(encoder, imgBuffer, {
						format: 'rgba',
					})
				}
				return
			}

			if (key !== undefined && this.BTN_SIZE) {
				this.streamDeck?.checkValidKeyIndex(key)
				const imgBuffer = await getBitmap(
					this.convertFeedbackToBitmapFeedback(feedback),
					this.BTN_SIZE,
					this.BTN_SIZE,
					isDown
				)
				await this.streamDeck?.fillKeyBuffer(key, imgBuffer, {
					format: 'rgba',
				})
			} else if (encoder !== undefined && this.ENC_SIZE_HEIGHT && this.ENC_SIZE_WIDTH) {
				const imgBuffer = await getBitmap(
					this.convertFeedbackToBitmapFeedback(feedback),
					this.ENC_SIZE_WIDTH,
					this.ENC_SIZE_HEIGHT,
					isDown
				)
				await streamdeck.fillEncoderLcd(encoder, imgBuffer, {
					format: 'rgba',
				})
			}
		} catch (e) {
			this.logger.debug(`Stream Deck: Exception thrown in updateFeedback()`, e)
		}
	}

	private convertFeedbackToBitmapFeedback(feedback: Feedback): BitmapFeedback | Feedback {
		const styleClassNames = feedback.styleClassNames
		if (!styleClassNames || !this.config.stylePresets) return feedback

		// Find the first match
		for (const name of styleClassNames) {
			const stylePreset = Object.values<StreamdeckStylePreset>(this.config.stylePresets).find(
				(preset) => preset.id === name
			)

			if (stylePreset) {
				return {
					...feedback,
					style: stylePreset,
				}
			}
		}

		return feedback
	}

	private quietUpdateFeedbackWithDownState = (trigger: string): void => {
		this.updateFeedback(trigger, this.isButtonDown[trigger] ?? false).catch((err) =>
			this.logger.error(`Stream Deck: Error updating feedback: ${err}`)
		)
	}

	setFeedback = async (triggerId: string, feedback: SomeFeedback): Promise<void> => {
		if (!this.streamDeck) return

		const { id: trigger, action } = StreamDeckDevice.parseTriggerId(triggerId)

		if (action === '') return

		this.feedbacks.set(trigger, action, feedback)

		await this.updateFeedback(trigger, this.isButtonDown[trigger] ?? false)
	}

	clearFeedbackAll = async (): Promise<void> => {
		const feedbackIds = this.feedbacks.allFeedbackIds()
		this.feedbacks.clear()

		await Promise.all(
			feedbackIds.map(async (key) => {
				return this.updateFeedback(key, false)
			})
		)
	}

	static getOptionsManifest(): object {
		return DEVICE_OPTIONS
	}
}

const ACTION_PRIORITIES = [Symbols.DOWN, Symbols.UP, Symbols.JOG, Symbols.MOVE, Symbols.SHUTTLE, Symbols.T_BAR]
const DEFAULT_BRIGHTNESS = 100
