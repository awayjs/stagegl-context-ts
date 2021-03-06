import { AbstractMethodError, ByteArray, Point, ProjectionBase, Rectangle } from '@awayjs/core';
import { ShaderRegisterCache } from '../../shaders/ShaderRegisterCache';
import { ShaderRegisterElement } from '../../shaders/ShaderRegisterElement';
import { Image2D } from '../../image/Image2D';
import { RTTBufferManager } from '../../managers/RTTBufferManager';
import { IProgram } from '../../base/IProgram';
import { ContextGLProfile } from '../../base/ContextGLProfile';
import { Stage } from '../../Stage';
import { AGALMiniAssembler } from '../../aglsl/assembler/AGALMiniAssembler';
import { IVao } from './../../base/IVao';
import { IContextGL } from '../../base/IContextGL';
import { ContextGLProgramType } from '../../base/ContextGLProgramType';

export class Filter3DTaskBase {
	protected _vertexConstantData = new Float32Array([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);

	public activateInternaly = false;
	public _registerCache: ShaderRegisterCache;

	public _positionIndex: number;
	public _uvIndex: number;
	public _inputTextureIndex: number;
	public _uvVarying: ShaderRegisterElement;

	protected _mainInputTexture: Image2D;
	protected _externalInput: boolean = false;

	public _scaledTextureWidth: number = -1;
	public _scaledTextureHeight: number = -1;
	public _rttManager: RTTBufferManager;
	public _textureWidth: number = -1;
	public _textureHeight: number = -1;
	private _textureDimensionsInvalid: boolean = true;
	protected _program3DInvalid: boolean = true;
	protected _program3D: IProgram;
	protected _target: Image2D;
	private _requireDepthRender: boolean;
	private _textureScale: number = 1;

	public rect: Rectangle = new Rectangle();
	public destPoint: Point = new Point();

	public vao: IVao;

	constructor(requireDepthRender: boolean = false) {
		this._requireDepthRender = requireDepthRender;

		this._registerCache = new ShaderRegisterCache(ContextGLProfile.BASELINE);
	}

	/**
	 * The texture scale for the input of this texture. This will define the output of the previous entry in the chain
	 */
	public get textureScale(): number {
		return this._textureScale;
	}

	public set textureScale(value: number) {
		if (this._textureScale == value)
			return;

		this._textureScale = value;
		this._scaledTextureWidth = this._textureWidth / this._textureScale;
		this._scaledTextureHeight = this._textureHeight / this._textureScale;
		this._textureDimensionsInvalid = true;
	}

	public get target(): Image2D {
		return this._target;
	}

	public set target(value: Image2D) {
		this._target = value;
	}

	public get rttManager(): RTTBufferManager {
		return this._rttManager;
	}

	public set rttManager(value: RTTBufferManager) {
		if (this._rttManager == value)
			return;

		this._rttManager = value;
		this._textureDimensionsInvalid = true;
	}

	public get textureWidth(): number {
		return this._textureWidth;
	}

	public set textureWidth(value: number) {
		if (this._textureWidth == value)
			return;

		this._textureWidth = value;
		this._scaledTextureWidth = this._textureWidth / this._textureScale;
		this._textureDimensionsInvalid = true;
	}

	public get textureHeight(): number {
		return this._textureHeight;
	}

	public set textureHeight(value: number) {
		if (this._textureHeight == value)
			return;

		this._textureHeight = value;
		this._scaledTextureHeight = (this._textureHeight) / this._textureScale;
		this._textureDimensionsInvalid = true;
	}

	public setMainInputTexture (image: Image2D, stage: Stage) {
		this._mainInputTexture = image;
		this._externalInput = !!image;

		if (this._externalInput) {
			this.textureWidth = image.width;
			this.textureHeight = image.height;
		}

		this.updateTextures(stage);
	}

	public getMainInputTexture(stage: Stage): Image2D {
		if (this._textureDimensionsInvalid)
			this.updateTextures(stage);

		return this._mainInputTexture;
	}

	public dispose(): void {
		if (this._mainInputTexture)
			this._mainInputTexture.dispose();

		if (this._program3D)
			this._program3D.dispose();

		if (this.vao) {
			this.vao.dispose();
			this.vao = null;
		}
	}

	public invalidateProgram(): void {
		this._program3DInvalid = true;
	}

	public updateProgram(stage: Stage): void {
		if (this._program3D)
			this._program3D.dispose();

		this._program3D = stage.context.createProgram();

		this._registerCache.reset();

		const vertexByteCode: ByteArray = (new AGALMiniAssembler()
			.assemble('part vertex 1\n' + this.getVertexCode() + 'endpart'))['vertex'].data;
		const fragmentByteCode: ByteArray = (new AGALMiniAssembler()
			.assemble('part fragment 1\n' + this.getFragmentCode() + 'endpart'))['fragment'].data;

		this._program3D.name = (<any> this.constructor).name;
		this._program3D.upload(vertexByteCode, fragmentByteCode);
		this._program3DInvalid = false;
	}

	public getVertexCode(): string {
		const temp1: ShaderRegisterElement = this._registerCache.getFreeVertexVectorTemp();

		const rect: ShaderRegisterElement = this._registerCache.getFreeVertexConstant();

		const position: ShaderRegisterElement = this._registerCache.getFreeVertexAttribute();
		this._positionIndex = position.index;

		const offset: ShaderRegisterElement = this._registerCache.getFreeVertexConstant();

		const uv: ShaderRegisterElement = this._registerCache.getFreeVertexAttribute();
		this._uvIndex = uv.index;

		this._uvVarying = this._registerCache.getFreeVarying();

		const code = 'mul ' + temp1 + '.xy, ' + position + ', ' + rect + '.zw\n' +
			'add ' + temp1 + '.xy, ' + temp1 + ', ' + rect + '.xy\n' +
			'mov ' + temp1 + '.w, ' + position + '.w\n' +
			'mov op, ' + temp1 + '\n' +
			'add ' + this._uvVarying + ', ' + uv + ', ' + offset + '.xy\n';

		return code;
	}

	public getFragmentCode(): string {
		throw new AbstractMethodError();
	}

	public updateTextures(stage: Stage): void {

		if (!this._externalInput) {
			if (this._mainInputTexture)
				this._mainInputTexture.dispose();

			this._mainInputTexture = new Image2D(this._scaledTextureWidth, this._scaledTextureHeight, false);
		}

		this._textureDimensionsInvalid = false;
	}

	public getProgram<T extends IProgram = IProgram>(stage: Stage): T {
		if (this._program3DInvalid)
			this.updateProgram(stage);

		return <T> this._program3D;
	}

	public activate(stage: Stage, _projection: ProjectionBase, _depthTexture: Image2D): void {
		const data = this._vertexConstantData;
		const index = this._positionIndex;

		if (this.rect.width === 0 || this.rect.height === 0) {
			this.rect.width = this._scaledTextureWidth;
			this.rect.height = this._scaledTextureHeight;
		}

		const paddedX = this.destPoint.x;
		const paddedY = this.destPoint.y;

		data[index + 0] = (paddedX * 2 + this.rect.width) / this._target.width - 1;
		data[index + 1] = (paddedY * 2 + this.rect.height) / this._target.height - 1;
		data[index + 2] = this.rect.width / this._target.width;
		data[index + 3] = this.rect.height / this._target.height;

		data[index + 4] = this.rect.x / this._mainInputTexture.width;
		data[index + 5] = this.rect.y / this._mainInputTexture.height;

		const context: IContextGL = stage.context;
		context.setProgramConstantsFromArray(ContextGLProgramType.VERTEX, data);
	}

	public deactivate(stage: Stage): void {
	}

	public get requireDepthRender(): boolean {
		return this._requireDepthRender;
	}

}