import {ByteArray}					from "@awayjs/core/lib/utils/ByteArray";

import {ITexture}						from "../base/ITexture";

import {TextureBaseGLES}				from "./TextureBaseGLES";

export class TextureGLES extends TextureBaseGLES implements ITexture
{

	public textureType:string = "texture2d";

	private _width:number;
	private _height:number;

	private _frameBuffer:WebGLFramebuffer;

	constructor(gl:WebGLRenderingContext, width:number, height:number)
	{
		super(gl);
		this._width = width;
		this._height = height;
		//
		// this._glTexture = this._gl.createTexture();
	}

	public get width():number
	{
		return this._width;
	}

	public get height():number
	{
		return this._height;
	}

	public get frameBuffer():WebGLFramebuffer
	{
		// if (!this._frameBuffer) {
		// 	this._frameBuffer = this._gl.createFramebuffer();
		// 	this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, this._frameBuffer);
		// 	this._gl.bindTexture(this._gl.TEXTURE_2D, this._glTexture);
		// 	this._gl.texImage2D(this._gl.TEXTURE_2D, 0, this._gl.RGBA, this._width, this._height, 0, this._gl.RGBA, this._gl.UNSIGNED_BYTE, null);
		//
		// 	var renderBuffer:GLESRenderbuffer = this._gl.createRenderbuffer();
		// 	this._gl.bindRenderbuffer(this._gl.RENDERBUFFER, renderBuffer);
		// 	this._gl.renderbufferStorage(this._gl.RENDERBUFFER, this._gl.DEPTH_STENCIL, this._width, this._height);
		//
		// 	this._gl.framebufferTexture2D(this._gl.FRAMEBUFFER, this._gl.COLOR_ATTACHMENT0, this._gl.TEXTURE_2D, this._glTexture, 0);
		// 	this._gl.framebufferRenderbuffer(this._gl.FRAMEBUFFER, this._gl.DEPTH_STENCIL_ATTACHMENT, this._gl.RENDERBUFFER, renderBuffer);
		//
		// 	this._gl.bindTexture(this._gl.TEXTURE_2D, null);
		// 	this._gl.bindRenderbuffer(this._gl.RENDERBUFFER, null);
		// 	this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, null);
		// }

		return this._frameBuffer;
	}

	public uploadFromData(image:HTMLImageElement, miplevel?:number);
	public uploadFromData(imageData:ImageData, miplevel?:number);
	public uploadFromData(data:any, miplevel:number = 0):void
	{
		// this._gl.bindTexture(this._gl.TEXTURE_2D, this._glTexture);
		// this._gl.texImage2D(this._gl.TEXTURE_2D, miplevel, this._gl.RGBA, this._gl.RGBA, this._gl.UNSIGNED_BYTE, data);
		// this._gl.bindTexture(this._gl.TEXTURE_2D, null);
	}

	public uploadCompressedTextureFromByteArray(data:ByteArray, byteArrayOffset:number /*uint*/, async:boolean = false):void
	{
		// var ext:Object = this._gl.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");
		// //this._gl.compressedTexImage2D(this._gl.TEXTURE_2D, 0, this)
	}
}