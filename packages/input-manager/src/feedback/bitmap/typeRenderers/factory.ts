import { CanvasRenderingContext2D } from 'skia-canvas'
import { ClassNames, Feedback } from '../../feedback'
import { ActionRenderer } from './action'
import { BaseAdLibRenderer } from './adlib/base'
import { BaseRenderer } from './base'

export function rendererFactory(
	feedback: Feedback,
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	scaleFactor: number
): BaseRenderer {
	if (feedback.classNames?.includes(ClassNames.AD_LIB)) {
		return new BaseAdLibRenderer(ctx, width, height, scaleFactor)
	}

	return new ActionRenderer(ctx, width, height, scaleFactor)
}
