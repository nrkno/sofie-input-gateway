/* eslint-disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run "yarn generate-schema-types" to regenerate this file.
 */

export interface MIDIControllerOptions {
	/**
	 * The name of the MIDI Input to connect to for incoming messages
	 */
	inputName?: string
	/**
	 * The name of the MIDI Output to connect to for sending feedback
	 */
	outputName?: string
	/**
	 * Configuration of the feedback behavior
	 */
	feedbackSettings?: {
		note?: MIDINoteOnFeedback[]
		cc?: MIDICCFeedback[]
	}
}
export interface MIDINoteOnFeedback {
	/**
	 * The trigger that this feedback relates to
	 */
	trigger?: string
	channel?: string
	note?: number
	velocity?: number
	velocityPresent?: number
	velocityNext?: number
	velocityOnAir?: number
}
export interface MIDICCFeedback {
	/**
	 * The trigger that this feedback relates to
	 */
	trigger?: string
	channel?: string
	cc?: number
	value?: number
	valuePresent?: number
	valueNext?: number
	valueOnAir?: number
}
