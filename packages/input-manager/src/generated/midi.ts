/* eslint-disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run "yarn generate-schema-types" to regenerate this file.
 */

export interface MIDIControllerOptions {
	inputName: string
	outputName?: string
	feedbackSettings?: {
		note?: MIDINoteOnFeedback[]
		cc?: MIDICCFeedback[]
	}
}
export interface MIDINoteOnFeedback {
	trigger: string
	channel: number
	note: number
	velocity?: number
	velocityPresent?: number
	velocityNext?: number
	velocityOnAir?: number
}
export interface MIDICCFeedback {
	trigger: string
	channel: number
	cc: number
	value?: number
	valuePresent?: number
	valueNext?: number
	valueOnAir?: number
}