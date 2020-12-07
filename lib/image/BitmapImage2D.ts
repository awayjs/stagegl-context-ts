import { ColorTransform, Matrix, Rectangle, Point, ColorUtils, IAssetAdapter, AssetEvent, IAsset } from '@awayjs/core';
import { UnloadManager, IUnloadable, UnloadService } from './../managers/UnloadManager';
import { Image2D } from './Image2D';
import { Settings } from './../Settings';

/**
 * The BitmapImage2D export class lets you work with the data(pixels) of a Bitmap
 * object. You can use the methods of the BitmapImage2D export class to create
 * arbitrarily sized transparent or opaque bitmap images and manipulate them
 * in various ways at runtime. You can also access the BitmapImage2D for a bitmap
 * image that you load with the <code>flash.Assets</code> or
 * <code>flash.display.Loader</code> classes.
 *
 * <p>This export class lets you separate bitmap rendering operations from the
 * internal display updating routines of flash. By manipulating a
 * BitmapImage2D object directly, you can create complex images without incurring
 * the per-frame overhead of constantly redrawing the content from vector
 * data.</p>
 *
 * <p>The methods of the BitmapImage2D export class support effects that are not
 * available through the filters available to non-bitmap display objects.</p>
 *
 * <p>A BitmapImage2D object contains an array of pixel data. This data can
 * represent either a fully opaque bitmap or a transparent bitmap that
 * contains alpha channel data. Either type of BitmapImage2D object is stored as
 * a buffer of 32-bit integers. Each 32-bit integer determines the properties
 * of a single pixel in the bitmap.</p>
 *
 * <p>Each 32-bit integer is a combination of four 8-bit channel values(from
 * 0 to 255) that describe the alpha transparency and the red, green, and blue
 * (ARGB) values of the pixel.(For ARGB values, the most significant byte
 * represents the alpha channel value, followed by red, green, and blue.)</p>
 *
 * <p>The four channels(alpha, red, green, and blue) are represented as
 * numbers when you use them with the <code>BitmapImage2D.copyChannel()</code>
 * method or the <code>DisplacementMapFilter.componentX</code> and
 * <code>DisplacementMapFilter.componentY</code> properties, and these numbers
 * are represented by the following constants in the BitmapImage2DChannel
 * class:</p>
 *
 * <ul>
 *   <li><code>BitmapImage2DChannel.ALPHA</code></li>
 *   <li><code>BitmapImage2DChannel.RED</code></li>
 *   <li><code>BitmapImage2DChannel.GREEN</code></li>
 *   <li><code>BitmapImage2DChannel.BLUE</code></li>
 * </ul>
 *
 * <p>You can attach BitmapImage2D objects to a Bitmap object by using the
 * <code>bitmapData</code> property of the Bitmap object.</p>
 *
 * <p>You can use a BitmapImage2D object to fill a Graphics object by using the
 * <code>Graphics.beginBitmapFill()</code> method.</p>
 *
 * <p>You can also use a BitmapImage2D object to perform batch tile rendering
 * using the <code>flash.display.Tilesheet</code> class.</p>
 *
 * <p>In Flash Player 10, the maximum size for a BitmapImage2D object
 * is 8,191 pixels in width or height, and the total number of pixels cannot
 * exceed 16,777,215 pixels.(So, if a BitmapImage2D object is 8,191 pixels wide,
 * it can only be 2,048 pixels high.) In Flash Player 9 and earlier, the limitation
 * is 2,880 pixels in height and 2,880 in width.</p>
 */

declare global {
	class WeakRef<T> {
		deref(): T;
		constructor(arg: T);
	}

	class FinalizationRegistry {
		constructor(callback: (v: any) => void);
		register(target: object, heldValue: any, token?: object): void;
		unregister(token: object): void;
	}

}

let HAS_REF = ('WeakRef' in window);
let alerted = false;

function REF_ENABLED() {
	if (alerted) return HAS_REF;

	alerted = true;
	HAS_REF = HAS_REF && Settings.ENABLE_WEAK_REF;

	if (HAS_REF) {
		console.debug('[ImageBitmap2D Experemental] Use WeakRef for ImageBitmap2D');
	}

	return HAS_REF;
}

function fastARGB_to_ABGR(val: number, hasAlpha = true) {
	const a = hasAlpha ? (val & 0xff000000) : 0xff000000;
	return (a
		| ((val & 0xff) << 16)
		| (val & 0xff00)
		| ((val & 0xff0000) >> 16) & 0xff) >>> 0;
}

interface LazyImageSymbolTag {
	needParse: boolean;
	lazyParser(): LazyImageSymbolTag;
	definition: {
		width: number;
		height: number;
		data: Uint8ClampedArray;
		isPMA?: boolean;
	}
}

export class BitmapImage2D extends Image2D implements IUnloadable {
	public static UNLOAD_EVENT = 'unload';

	public static assetType: string = '[image BitmapImage2D]';

	public static _unloadManager: UnloadManager<BitmapImage2D>;

	public static getManager(stage: Stage): UnloadManager<BitmapImage2D> {
		if (!Settings.ENABLE_UNLOAD_BITMAP || !stage) {
			return null;
		}

		if (this._unloadManager) {
			return this._unloadManager;
		}

		const hasFence = (<ContextWebGL> stage.context).hasFence;

		this._unloadManager = UnloadService.createManager({
			name : 'BitmapImage2D' + (hasFence ? 'async' : ''),
			priority: 0,
			maxUnloadTasks: (hasFence
				? Settings.MAX_BITMAP_UNLOAD_TASKS_ASYNC
				: Settings.MAX_BITMAP_UNLOAD_TASKS),
			exectionPeriod: 100, // every 100 ms GC will runs to unload bitmap
		});

		return this._unloadManager;
	}

	public _lazySymbol: LazyImageSymbolTag;

	protected _isSymbolSource: boolean = false;
	protected _data: Uint8ClampedArray;
	protected _isWeakRef: boolean = false;
	protected _finalizer: FinalizationRegistry;
	protected _weakRefAdapter: WeakRef<IAssetAdapter>;
	protected _transparent: boolean;
	protected _unpackPMA: boolean = true;
	protected _stage: Stage;
	protected _locked: boolean = false;
	protected _floodStack: number[] = [];

	protected _nestedBitmap: BitmapImage2D[] = [];
	protected _sourceBitmap: BitmapImage2D;

	// request a _data field without a calling getter of 'data'

	/*internal*/ getDataInternal(constructEmpty = true): Uint8ClampedArray {
		this.applySymbol();

		if (!this._data && (constructEmpty || this._alphaChannel)) {
			this._data = new Uint8ClampedArray(this.width * this.height * 4);
		}

		if (this._alphaChannel) {
			const buff = this._alphaChannel;
			for (let i = 0; i < buff.length; i++) {
				this._data[i * 4 + 3] = buff[i];
			}

			//remove alpha data once applied
			this._alphaChannel = null;
		}

		return this._data;
	}

	/**
	 * @description Upload flag, marking a image that it was uploaded on GPU
	 * and can use GPU operations
	 * fillRect can be implemented on GPU or CPU
	 */
	public wasUpload: boolean = false;

	public get sourceBitmap(): BitmapImage2D {
		return this._sourceBitmap;
	}

	private _needUpload: boolean = false;
	public invalidateGPU() {
		this._needUpload = true;
		this.invalidate();
	}

	public invalidate() {
		if (!this._needUpload) {
			return;
		}

		if (this._locked) {
			return;
		}

		super.invalidate();
	}

	public isUnloaded = false;
	public lastUsedTime = 0;
	public get canUnload(): boolean {
		return !this._sourceBitmap
				&& !this._nestedBitmap.length
				&& !this._locked
				&& !this._isSymbolSource;
	}

	public unmarkToUnload() {
		BitmapImage2D.getManager(this._stage)?.removeTask(this);
	}

	public markToUnload() {
		if (!BitmapImage2D.getManager(this._stage)) return;
		if (this._isSymbolSource) return;

		this.lastUsedTime = BitmapImage2D._unloadManager.correctedTime;

		// add before, because task can be already exist
		// and if we a run GC before - it kill texture
		BitmapImage2D._unloadManager.addTask(this);

		// run execution when is marked that used
		// const count = BitmapImage2D.unloadManager.execute();
		// count && console.debug('[BitmapImage2D Experemental] Texture was unloaded from GPU by timer:', count);
	}

	public unload(): void {
		// copy buffer back to _data
		// this.syncData();
		// dispose texture
		this.lastUsedTime = -1;
		this.dispatchEvent(new AssetEvent(BitmapImage2D.UNLOAD_EVENT, this));
		this.invalidateGPU();
	}

	private _customMipLevels: BitmapImage2D[];

	public addMipLevel(newLevel: BitmapImage2D): void {
		if (!this._customMipLevels)
			this._customMipLevels = [];
		this._customMipLevels.push(newLevel);
	}

	public get mipLevels(): BitmapImage2D[] {
		return this._customMipLevels;
	}

	/**
	 *
	 * @returns {string}
	 */
	public get assetType(): string {
		return BitmapImage2D.assetType;
	}

	/**
	 * Defines whether the bitmap image supports per-pixel transparency. You can
	 * set this value only when you construct a BitmapImage2D object by passing in
	 * <code>true</code> for the <code>transparent</code> parameter of the
	 * constructor. Then, after you create a BitmapImage2D object, you can check
	 * whether it supports per-pixel transparency by determining if the value of
	 * the <code>transparent</code> property is <code>true</code>.
	 */
	public get transparent(): boolean {
		return this._transparent;
	}

	public set transparent(value: boolean) {
		this._transparent = value;
	}

	/**
	 * Store a mode, witch should be uploaded to GPU
	 * not all case PMA is should be enabled
	 */
	get unpackPMA() {
		return this._unpackPMA && this._transparent;
	}

	/**
	 * Creates a BitmapImage2D object with a specified width and height. If you
	 * specify a value for the <code>fillColor</code> parameter, every pixel in
	 * the bitmap is set to that color.
	 *
	 * <p>By default, the bitmap is created as transparent, unless you pass
	 * the value <code>false</code> for the transparent parameter. After you
	 * create an opaque bitmap, you cannot change it to a transparent bitmap.
	 * Every pixel in an opaque bitmap uses only 24 bits of color channel
	 * information. If you define the bitmap as transparent, every pixel uses 32
	 * bits of color channel information, including an alpha transparency
	 * channel.</p>
	 *
	 * @param width       The width of the bitmap image in pixels.
	 * @param height      The height of the bitmap image in pixels.
	 * @param transparent Specifies whether the bitmap image supports per-pixel
	 *                    transparency. The default value is <code>true</code>
	 *                    (transparent). To create a fully transparent bitmap,
	 *                    set the value of the <code>transparent</code>
	 *                    parameter to <code>true</code> and the value of the
	 *                    <code>fillColor</code> parameter to 0x00000000(or to
	 *                    0). Setting the <code>transparent</code> property to
	 *                    <code>false</code> can result in minor improvements
	 *                    in rendering performance.
	 * @param fillColor   A 32-bit ARGB color value that you use to fill the
	 *                    bitmap image area. The default value is
	 *                    0xFFFFFFFF(solid white).
	 */
	constructor(
		width: number, height: number, transparent: boolean = true,
		fillColor: number = null, powerOfTwo: boolean = true, stage: Stage = null) {

		super(width, height, powerOfTwo);

		if (stage) {
			// init
			BitmapImage2D.getManager(stage);
		}

		//this._data = new Uint8ClampedArray(4 * this._rect.width * this._rect.height);
		this._transparent = transparent;
		this._stage = stage;

		if (fillColor != null)
			this.fillRect(this._rect, fillColor);
	}

	public addLazySymbol(tag: LazyImageSymbolTag) {
		this._lazySymbol = tag;
		this._isSymbolSource = true;

		this.invalidateGPU();
	}

	public applySymbol(): boolean {
		if (!this._lazySymbol || !this._lazySymbol.needParse) {
			return false;
		}

		this._lazySymbol.lazyParser();
		this._data = this._lazySymbol.definition.data;

		// disable UNPACK_PREMULTIPLE_ALPHA becasue already is PMA
		this._unpackPMA = !this._lazySymbol.definition.isPMA;

		// console.log("Run lazy bitmap parser", this.id);
		// hop
		this._lazySymbol = null;

		return true;
	}

	/**
	 * @description transfer adapter to weak mode
	 * Reference will dropped, and adapter destroyed after collecting a adapter
	 */
	public useWeakRef() {
		if (!REF_ENABLED() || this._isWeakRef) {
			return;
		}

		this._isWeakRef = true;

		if (!this._finalizer) {
			this._finalizer = new FinalizationRegistry(this.onAdapterDropped.bind(this));
		}

		this.adapter = this._adapter;
	}

	public unuseWeakRef() {
		if (!this._isWeakRef) {
			return;
		}

		this._isWeakRef = false;
		this._finalizer.unregister(this);
		this._weakRefAdapter = null;
		this.adapter = this._adapter;
	}

	get isWeakRef() {
		return this._isWeakRef;
	}

	set adapter(v: IAssetAdapter) {

		if (this._isWeakRef) {

			this._finalizer.unregister(this);

			if (v) {
				this._weakRefAdapter = new WeakRef<IAssetAdapter>(v);
				this._finalizer.register(v, this.id, this);
			} else {
				this._weakRefAdapter = null;
			}

			// drop hard ref
			this._adapter = null;
		} else {
			this._adapter = v;
		}
	}

	get adapter() {
		return  (this._weakRefAdapter ? this._weakRefAdapter.deref() : this._adapter) || this;
	}

	private onAdapterDropped(id: number) {
		console.debug('[ImageBitmap2D Experemental] Disposing adaptee, GC runs for:', id);
		this.dispose();
	}

	public addNestedReference(child: BitmapImage2D) {
		if (this._sourceBitmap) {
			this._sourceBitmap.addNestedReference(child);
			return;
		}

		this._nestedBitmap.push(child);
		child._sourceBitmap = this;

		//console.debug(`[BitmapImage] Add nested ${child.id} -> ${this.id}`);
	}

	public dropNestedReference(child: BitmapImage2D): boolean {
		const index = this._nestedBitmap.indexOf(child);
		return index > -1 && !!this._nestedBitmap.splice(index, 1);
	}

	/**
	 * @description Detach clone from source, and apply texture directly
	 */
	public dropAllReferences(fireDroping = true) {

		if (this._nestedBitmap.length) {
			for (const nest of this._nestedBitmap) {
				nest.dropAllReferences(false);
			}
			this._nestedBitmap.length = 0;
		}

		if (!this._sourceBitmap) {
			return;
		}

		const source = this._sourceBitmap;

		this._sourceBitmap = null;

		fireDroping && source.dropNestedReference(this);

		this.deepClone(source);

		//console.debug("[BitmapImage] drop nested references:", source.id);
	}

	protected deepClone(from: BitmapImage2D) {
		this.setPixels(this._rect, from.data);
		this.invalidateGPU();
	}

	public copyTo(target: BitmapImage2D): BitmapImage2D {
		this.addNestedReference(target);
		return target;
	}

	/**
	 * Returns a new BitmapImage2D object that is a clone of the original instance
	 * with an exact copy of the contained bitmap.
	 *
	 * @return A new BitmapImage2D object that is identical to the original.
	 */
	public clone(): BitmapImage2D {
		const clone = new BitmapImage2D(this._rect.width, this._rect.height, this._transparent, null, this._powerOfTwo);
		this.addNestedReference(clone);

		return clone;
	}

	/**
	 * Adjusts the color values in a specified area of a bitmap image by using a
	 * <code>ColorTransform</code> object. If the rectangle matches the
	 * boundaries of the bitmap image, this method transforms the color values of
	 * the entire image.
	 *
	 * @param rect           A Rectangle object that defines the area of the
	 *                       image in which the ColorTransform object is applied.
	 * @param colorTransform A ColorTransform object that describes the color
	 *                       transformation values to apply.
	 */
	public colorTransform(rect: Rectangle, colorTransform: ColorTransform): void {
		this.dropAllReferences();

		let i: number,
			j: number,
			index: number;

		const data = this.data;

		for (i = 0; i < rect.width; ++i) {
			for (j = 0; j < rect.height; ++j) {
				index = (i + rect.x + (j + rect.y) * this._rect.width) * 4;

				data[index] = data[index] * colorTransform.redMultiplier + colorTransform.redOffset;
				data[index + 1] = data[index + 1] * colorTransform.greenMultiplier + colorTransform.greenOffset;
				data[index + 2] = data[index + 2] * colorTransform.blueMultiplier + colorTransform.blueOffset;
				data[index + 3] = data[index + 3] * colorTransform.alphaMultiplier + colorTransform.alphaOffset;
			}
		}

		this.invalidateGPU();
	}

	/**
	 * Transfers data from one channel of another BitmapImage2D object or the
	 * current BitmapImage2D object into a channel of the current BitmapImage2D object.
	 * All of the data in the other channels in the destination BitmapImage2D object
	 * are preserved.
	 *
	 * <p>The source channel value and destination channel value can be one of
	 * following values: </p>
	 *
	 * <ul>
	 *   <li><code>BitmapImage2DChannel.RED</code></li>
	 *   <li><code>BitmapImage2DChannel.GREEN</code></li>
	 *   <li><code>BitmapImage2DChannel.BLUE</code></li>
	 *   <li><code>BitmapImage2DChannel.ALPHA</code></li>
	 * </ul>
	 *
	 * @param sourceBitmapImage2D The input bitmap image to use. The source image
	 *                         can be a different BitmapImage2D object or it can
	 *                         refer to the current BitmapImage2D object.
	 * @param sourceRect       The source Rectangle object. To copy only channel
	 *                         data from a smaller area within the bitmap,
	 *                         specify a source rectangle that is smaller than
	 *                         the overall size of the BitmapImage2D object.
	 * @param destPoint        The destination Point object that represents the
	 *                         upper-left corner of the rectangular area where
	 *                         the new channel data is placed. To copy only
	 *                         channel data from one area to a different area in
	 *                         the destination image, specify a point other than
	 *                        (0,0).
	 * @param sourceChannel    The source channel. Use a value from the
	 *                         BitmapImage2DChannel class
	 *                        (<code>BitmapImage2DChannel.RED</code>,
	 *                         <code>BitmapImage2DChannel.BLUE</code>,
	 *                         <code>BitmapImage2DChannel.GREEN</code>,
	 *                         <code>BitmapImage2DChannel.ALPHA</code>).
	 * @param destChannel      The destination channel. Use a value from the
	 *                         BitmapImage2DChannel class
	 *                        (<code>BitmapImage2DChannel.RED</code>,
	 *                         <code>BitmapImage2DChannel.BLUE</code>,
	 *                         <code>BitmapImage2DChannel.GREEN</code>,
	 *                         <code>BitmapImage2DChannel.ALPHA</code>).
	 * @throws TypeError The sourceBitmapImage2D, sourceRect or destPoint are null.
	 */
	/* eslint-disable-next-line */
	public copyChannel(sourceBitmap: BitmapImage2D, sourceRect: Rectangle, destPoint: Point, sourceChannel: number, destChannel: number): void {
		this.dropAllReferences();

		const sourceData: Uint8ClampedArray = sourceBitmap.data;
		const destData: Uint8ClampedArray = this.data;

		const sourceOffset: number = Math.round(Math.log(sourceChannel) / Math.log(2));
		const destOffset: number = Math.round(Math.log(destChannel) / Math.log(2));

		const sourceX: number = Math.round(sourceRect.x);
		const sourceY: number = Math.round(sourceRect.y);
		const destX: number = Math.round(destPoint.x);
		const destY: number = Math.round(destPoint.y);

		let i: number, j: number, sourceIndex: number, destIndex: number;
		for (i = 0; i < sourceRect.width; ++i) {
			for (j = 0; j < sourceRect.height; ++j) {
				sourceIndex = (i + sourceX + (j + sourceY) * sourceBitmap.width) * 4;
				destIndex = (i + destX + (j + destY) * this._rect.width) * 4;

				destData[destIndex + destOffset] = sourceData[sourceIndex + sourceOffset];
			}
		}

		this.invalidateGPU();
	}

	/* eslint-disable-next-line */
	public merge(source: BitmapImage2D, sourceRect: Rectangle, destPoint: Point, redMultiplier: number, greenMultiplier: number, blueMultiplier: number, alphaMultiplier: number) {
		this.dropAllReferences();

		const dest: Uint8ClampedArray = this.getDataInternal(true);
		const src: Uint8ClampedArray = source.data;

		redMultiplier = ~~redMultiplier;
		greenMultiplier = ~~greenMultiplier;
		blueMultiplier = ~~blueMultiplier;
		alphaMultiplier = ~~alphaMultiplier;

		let i: number, j: number, index: number;
		for (i = 0; i < sourceRect.width; ++i) {
			for (j = 0; j < sourceRect.height; ++j) {
				index = (i + sourceRect.x + (j + sourceRect.y) * this.width) * 4;

				/* eslint-disable */
				dest[index] = ~~((src[index] * redMultiplier + dest[index] * (0x100 - redMultiplier)) / 0x100);
				dest[index + 1] = ~~((src[index + 1] * greenMultiplier + dest[index + 1] * (0x100 - greenMultiplier)) / 0x100);
				dest[index + 2] = ~~((src[index + 2] * blueMultiplier + dest[index + 2] * (0x100 - blueMultiplier)) / 0x100);
				dest[index + 3] = ~~((src[index + 3] * alphaMultiplier + dest[index + 3] * (0x100 - alphaMultiplier)) / 0x100);
				/* eslint-enable */
			}
		}

		this.invalidateGPU();
	}

	/**
	 * Frees memory that is used to store the BitmapImage2D object.
	 *
	 * <p>When the <code>dispose()</code> method is called on an image, the width
	 * and height of the image are set to 0. All subsequent calls to methods or
	 * properties of this BitmapImage2D instance fail, and an exception is thrown.
	 * </p>
	 *
	 * <p><code>BitmapImage2D.dispose()</code> releases the memory occupied by the
	 * actual bitmap data, immediately(a bitmap can consume up to 64 MB of
	 * memory). After using <code>BitmapImage2D.dispose()</code>, the BitmapImage2D
	 * object is no longer usable and an exception may be thrown if
	 * you call functions on the BitmapImage2D object. However,
	 * <code>BitmapImage2D.dispose()</code> does not garbage collect the BitmapImage2D
	 * object(approximately 128 bytes); the memory occupied by the actual
	 * BitmapImage2D object is released at the time the BitmapImage2D object is
	 * collected by the garbage collector.</p>
	 *
	 */
	public dispose(): void {
		BitmapImage2D.getManager(this._stage)?.removeTask(this);

		if (this._isWeakRef) {
			this._finalizer.unregister(this);
		}

		this.dropAllReferences();
		this.clear();

		this._data = null;
		this._rect = null;
		this._transparent = null;
		this._locked = null;
	}

	public getColorBoundsRect(mask: number, color: number, findColor: boolean = true): Rectangle {
		const buffer = new Uint32Array(this.getDataInternal(true).buffer);
		const size = this.rect;

		color = fastARGB_to_ABGR(color, this._transparent);
		mask = fastARGB_to_ABGR(mask, this._transparent);

		let minX = size.width,
			minY = size.height,
			maxX = 0,
			maxY = 0;

		let has = false;

		// const start = performance.now();

		for (let j = 0; j < size.height; j++) {
			for (let i = 0; i < size.width; i++) {
				let  c = buffer[j * size.width + i];

				c = (c & mask) >>> 0;

				if ((c === color && findColor) || (c !== color && !findColor)) {
					has = true;

					minX = i < minX ? i : minX; // Math.min(minX, i);
					maxX = i > maxX ? i : maxX; // Math.max(maxX, i);
					minY = j < minY ? j : minY; //Math.min(minY, j);
					maxY = j > maxY ? j : maxY; // Math.max(maxY, j);
				}
			}
		}

		//console.log("getColorBoundsRect not implemented yet in flash/BitmapData");
		const d = has
			? new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1)
			: new Rectangle(0, 0, 0, 0);

		/*
		const delta = performance.now() - start;

		console.debug(
			'ColoreRect (mask, color, rect, time):',
			mask.toString(16),
			color.toString(16),
			d._rawData,
			delta);
		*/
		return d;
	}

	// https://lodev.org/cgtutor/floodfill.html
	// scanline method implementation

	public floodFill(x: number, y: number, color: number): void {
		this.dropAllReferences();

		x = x | 0;
		y = y | 0;

		//const start = performance.now();

		// needs update data when it use GL rendering mode
		const data = new Uint32Array(this.getDataInternal(true).buffer);

		const width = this._rect.width;
		const height = this._rect.height;
		const stack = this._floodStack;

		// avoid reloaction. it costly
		stack.length = width * height * 2;

		const oldc32 = data[(x + y * width)];
		//const rect = [100000,100000,0,0];

		let [newA, newR, newG, newB] = ColorUtils.float32ColorToARGB(color);

		newA =  this._transparent ? newA : 0xff;
		// premultiply
		newR = newR * newA / 0xff | 0;
		newG = newG * newA / 0xff | 0;
		newB = newB * newA / 0xff | 0;

		const newc32 = ((newA << 24) | (newB << 16) | (newG << 8) | (newR)) >>> 0;

		let x1 = 0;
		let spanAbove, spanBelow;
		let stackIndex = 0;

		stack[stackIndex++] = x;
		stack[stackIndex++] = y;

		while (stackIndex > 0) {
			y = stack[--stackIndex];
			x1 = x = stack[--stackIndex];

			while (x1 >= 0 && data[y * width + x1] === oldc32) {
				x1--;
			}

			x1++;
			spanAbove = spanBelow = false;

			while (x1 < width && data[y * width + x1] === oldc32) {
				data[y * width + x1] = newc32;

				/*
				rect[0] = rect[0] > x1 ? x1 : rect[0];
				rect[1] = rect[1] > y ? y : rect[1];
				rect[2] = rect[2] < x1 ? x1 : rect[2];
				rect[3] = rect[3] < y ? y : rect[3];
				*/
				if (!spanAbove && y > 0 && data[(y - 1) * width + x1] === oldc32) {
					stack[stackIndex++] = x1;
					stack[stackIndex++] = y - 1;
					spanAbove = true;
				} else if (spanAbove && y > 0 && data[(y - 1) * width + x1] !== oldc32) {
					spanAbove = false;
				}

				if (!spanBelow && y < height - 1 && data[(y + 1) * width + x1] === oldc32) {
					stack[stackIndex++] = x1;
					stack[stackIndex++] = y + 1;
					spanBelow = true;
				} else if (spanBelow && y < height - 1 && data[(y + 1) * width + x1] !== oldc32) {
					spanBelow = false;
				}

				x1++;
			}
		}

		/*
		rect[2] -= rect[0];
		rect[3] -= rect[1];

		if(rect[2] * rect[3]) {
			rect[2] += 1;
			rect[3] += 1;
		}

		const delta = performance.now() - start;
		console.debug(
			"FloodFill (sourceColor, targetColor, source rect, result, time):",
			oldc32.toString(16), newc32.toString(16), this._rect._rawData, rect, delta,)
		*/

		this.invalidateGPU();
	}

	public drawBitmap(
		source: Uint8ClampedArray, offsetX: number, offsetY: number,
		width: number, height: number, matrix: Matrix = null): void {

		this.dropAllReferences();

		BitmapImageUtils.drawBitmap(
			source, offsetX, offsetY, width, height, this.data, 0, 0, this._rect.width, this._rect.height, matrix);

		this.invalidateGPU();
	}

	/**
	 * Fills a rectangular area of pixels with a specified ARGB color.
	 *
	 * @param rect  The rectangular area to fill.
	 * @param color The ARGB color value that fills the area. ARGB colors are
	 *              often specified in hexadecimal format; for example,
	 *              0xFF336699.
	 * @throws TypeError The rect is null.
	 */
	public fillRect(rect: Rectangle, color: number): void {
		this.dropAllReferences();

		if (!this._data) {
			this._data = new Uint8ClampedArray(this.width * this.height * 4);
		}

		const
			x = ~~rect.x,
			y = ~~rect.y,
			width = ~~rect.width,
			height = ~~rect.height,
			data = new Uint32Array(this._data.buffer);

		let rgba = 0;
		if (this._transparent) {
			const [a, r, g, b] = ColorUtils.float32ColorToARGB(color);
			// PMA
			// we should FLIP bytes because a use UINT32
			rgba = ColorUtils.ARGBtoFloat32(
				a,
				b * a / 0xff | 0,
				g * a / 0xff | 0,
				r * a / 0xff | 0) >>> 0;

			/**
			 * TW2 has bug with transition over timeline when used a PMA
			 * I think that caused by invalid blend mode
			 */
			this._unpackPMA = false;
		} else {
			rgba = fastARGB_to_ABGR(color & 0xffffff, false);
		}

		//fast path for complete fill
		if (x == 0 && y == 0 && width == this._rect.width && height == this._rect.height) {
			data.fill(rgba);
		} else {
			let j: number;
			let index: number;
			for (j = 0; j < height; ++j) {

				index = x + (j + y) * this._rect.width;

				data.fill(rgba, index, index + width);
			}
		}

		this.invalidateGPU();
	}

	/**
	 * Returns an integer that represents an RGB pixel value from a BitmapImage2D
	 * object at a specific point(<i>x</i>, <i>y</i>). The
	 * <code>getPixel()</code> method returns an unmultiplied pixel value. No
	 * alpha information is returned.
	 *
	 * <p>All pixels in a BitmapImage2D object are stored as premultiplied color
	 * values. A premultiplied image pixel has the red, green, and blue color
	 * channel values already multiplied by the alpha data. For example, if the
	 * alpha value is 0, the values for the RGB channels are also 0, independent
	 * of their unmultiplied values. This loss of data can cause some problems
	 * when you perform operations. All BitmapImage2D methods take and return
	 * unmultiplied values. The internal pixel representation is converted from
	 * premultiplied to unmultiplied before it is returned as a value. During a
	 * set operation, the pixel value is premultiplied before the raw image pixel
	 * is set.</p>
	 *
	 * @param x The <i>x</i> position of the pixel.
	 * @param y The <i>y</i> position of the pixel.
	 * @return A number that represents an RGB pixel value. If the(<i>x</i>,
	 *         <i>y</i>) coordinates are outside the bounds of the image, the
	 *         method returns 0.
	 */
	public getPixel(x, y): number {

		const
			index = (~~x + ~~y * this._rect.width) * 4,
			data = this._data;

		const
			r = data[index + 0],
			g = data[index + 1],
			b = data[index + 2],
			a = data[index + 3];

		//returns black if fully transparent
		if (!a)
			return 0x0;

		return (r * 0xFF / a << 16) | (g * 0xFF / a << 8) | b * 0xFF / a;
	}

	/**
	 * Returns an ARGB color value that contains alpha channel data and RGB data.
	 * This method is similar to the <code>getPixel()</code> method, which
	 * returns an RGB color without alpha channel data.
	 *
	 * <p>All pixels in a BitmapImage2D object are stored as premultiplied color
	 * values. A premultiplied image pixel has the red, green, and blue color
	 * channel values already multiplied by the alpha data. For example, if the
	 * alpha value is 0, the values for the RGB channels are also 0, independent
	 * of their unmultiplied values. This loss of data can cause some problems
	 * when you perform operations. All BitmapImage2D methods take and return
	 * unmultiplied values. The internal pixel representation is converted from
	 * premultiplied to unmultiplied before it is returned as a value. During a
	 * set operation, the pixel value is premultiplied before the raw image pixel
	 * is set.</p>
	 *
	 * @param x The <i>x</i> position of the pixel.
	 * @param y The <i>y</i> position of the pixel.
	 * @return A number representing an ARGB pixel value. If the(<i>x</i>,
	 *         <i>y</i>) coordinates are outside the bounds of the image, 0 is
	 *         returned.
	 */
	public getPixel32(x, y): number {

		let index: number = (~~x + ~~y * this._rect.width) * 4;
		const data: Uint8ClampedArray = this._data;

		const
			r = data[index++],
			g = data[index++],
			b = data[index++],
			a = data[index];

		if (!a)
			return 0x0;

		return ((a << 24) | (r * 0xFF / a << 16) | (g * 0xFF / a << 8) | b * 0xFF / a) >>> 0;
	}

	public getPixelData(x, y, imagePixel: Uint8ClampedArray): void {
		let index: number = (x + y * this._rect.width) * 4;
		const data: Uint8ClampedArray = this._data;

		imagePixel[0] = data[index++];
		imagePixel[1] = data[index++];
		imagePixel[2] = data[index++];
		imagePixel[3] = data[index];
	}

	public setPixelData(x, y, imagePixel: Uint8ClampedArray): void {
		this.dropAllReferences();

		const index: number = (x + y * this._rect.width) * 4;
		const data: Uint8ClampedArray = this.data;

		data[index + 0] = imagePixel[0];
		data[index + 1] = imagePixel[1];
		data[index + 2] = imagePixel[2];
		data[index + 3] = this._transparent ? imagePixel[3] : 0xFF;

		this.invalidateGPU();
	}

	/**
	 * Locks an image so that any objects that reference the BitmapImage2D object,
	 * such as Bitmap objects, are not updated when this BitmapImage2D object
	 * changes. To improve performance, use this method along with the
	 * <code>unlock()</code> method before and after numerous calls to the
	 * <code>setPixel()</code> or <code>setPixel32()</code> method.
	 *
	 */
	public lock(): void {
		if (this._locked)
			return;

		this._locked = true;
	}

	/**
	 * Converts an Array into a rectangular region of pixel data. For each pixel,
	 * an Array element is read and written into the BitmapImage2D pixel. The data
	 * in the Array is expected to be 32-bit ARGB pixel values.
	 *
	 * @param rect        Specifies the rectangular region of the BitmapImage2D
	 *                    object.
	 * @param inputArray  An Array that consists of 32-bit unmultiplied pixel
	 *                    values to be used in the rectangular region.
	 * @throws RangeError The vector array is not large enough to read all the
	 *                    pixel data.
	 */
	public setArray(rect: Rectangle, inputArray: Array<number>): void {
		this.dropAllReferences();

		let i: number, j: number, index: number, argb: number[];
		const data = this.data;

		for (i = 0; i < rect.width; ++i) {
			for (j = 0; j < rect.height; ++j) {
				argb = ColorUtils.float32ColorToARGB(inputArray[i + j * rect.width]);
				index = (i + rect.x + (j + rect.y) * this._rect.width) * 4;

				data[index + 0] = argb[1];
				data[index + 1] = argb[2];
				data[index + 2] = argb[3];
				data[index + 3] = this._transparent ? argb[0] : 0xFF;
			}
		}

		this.invalidateGPU();
	}

	/**
	 * Sets a single pixel of a BitmapImage2D object. The current alpha channel
	 * value of the image pixel is preserved during this operation. The value of
	 * the RGB color parameter is treated as an unmultiplied color value.
	 *
	 * <p><b>Note:</b> To increase performance, when you use the
	 * <code>setPixel()</code> or <code>setPixel32()</code> method repeatedly,
	 * call the <code>lock()</code> method before you call the
	 * <code>setPixel()</code> or <code>setPixel32()</code> method, and then call
	 * the <code>unlock()</code> method when you have made all pixel changes.
	 * This process prevents objects that reference this BitmapImage2D instance from
	 * updating until you finish making the pixel changes.</p>
	 *
	 * @param x     The <i>x</i> position of the pixel whose value changes.
	 * @param y     The <i>y</i> position of the pixel whose value changes.
	 * @param color The resulting RGB color for the pixel.
	 */
	public setPixel(x: number, y: number, color: number): void {
		this.dropAllReferences();

		const
			index = (~~x + ~~y * this._rect.width) * 4,
			argb = ColorUtils.float32ColorToARGB(color),
			data = this.data;

		data[index + 0] = argb[1];
		data[index + 1] = argb[2];
		data[index + 2] = argb[3];
		data[index + 3] = 0xff;

		this.invalidateGPU();
	}

	public setPixelFromArray(x: number, y: number, colors: number[]): void {
		this.dropAllReferences();

		const index: number = (x + y * this._rect.width) * 4, data: Uint8ClampedArray = this.data;

		data[index + 0] = colors[1] * colors[0] | 0;
		data[index + 1] = colors[2] * colors[0] | 0;
		data[index + 2] = colors[3] * colors[0] | 0;
		data[index + 3] = colors[0] * 0xff | 0;

		this._unpackPMA = false;
		this.invalidateGPU();
	}

	/**
	 * Sets the color and alpha transparency values of a single pixel of a
	 * BitmapImage2D object. This method is similar to the <code>setPixel()</code>
	 * method; the main difference is that the <code>setPixel32()</code> method
	 * takes an ARGB color value that contains alpha channel information.
	 *
	 * <p>All pixels in a BitmapImage2D object are stored as premultiplied color
	 * values. A premultiplied image pixel has the red, green, and blue color
	 * channel values already multiplied by the alpha data. For example, if the
	 * alpha value is 0, the values for the RGB channels are also 0, independent
	 * of their unmultiplied values. This loss of data can cause some problems
	 * when you perform operations. All BitmapImage2D methods take and return
	 * unmultiplied values. The internal pixel representation is converted from
	 * premultiplied to unmultiplied before it is returned as a value. During a
	 * set operation, the pixel value is premultiplied before the raw image pixel
	 * is set.</p>
	 *
	 * <p><b>Note:</b> To increase performance, when you use the
	 * <code>setPixel()</code> or <code>setPixel32()</code> method repeatedly,
	 * call the <code>lock()</code> method before you call the
	 * <code>setPixel()</code> or <code>setPixel32()</code> method, and then call
	 * the <code>unlock()</code> method when you have made all pixel changes.
	 * This process prevents objects that reference this BitmapImage2D instance from
	 * updating until you finish making the pixel changes.</p>
	 *
	 * @param x     The <i>x</i> position of the pixel whose value changes.
	 * @param y     The <i>y</i> position of the pixel whose value changes.
	 * @param color The resulting ARGB color for the pixel. If the bitmap is
	 *              opaque(not transparent), the alpha transparency portion of
	 *              this color value is ignored.
	 */
	public setPixel32(x: number, y: number, color: number): void {
		this.dropAllReferences();

		const index = (~~x + ~~y * this._rect.width) * 4;
		const argb = ColorUtils.float32ColorToARGB(color);
		const data = this.data;

		const factor = this._transparent ? argb[0] / 0xff : 1;

		data[index + 0] = argb[1] * factor | 0;
		data[index + 1] = argb[2] * factor | 0;
		data[index + 2] = argb[3] * factor | 0;
		data[index + 3] = this._transparent ? argb[0] : 0xFF;

		this.invalidateGPU();
	}

	/**
	 * Converts a byte array into a rectangular region of pixel data. For each
	 * pixel, the <code>ByteArray.readUnsignedInt()</code> method is called and
	 * the return value is written into the pixel. If the byte array ends before
	 * the full rectangle is written, the function returns. The data in the byte
	 * array is expected to be 32-bit ARGB pixel values. No seeking is performed
	 * on the byte array before or after the pixels are read.
	 *
	 * @param rect           Specifies the rectangular region of the BitmapImage2D
	 *                       object.
	 * @param inputByteArray A ByteArray object that consists of 32-bit
	 *                       unmultiplied pixel values to be used in the
	 *                       rectangular region.
	 * @throws EOFError  The <code>inputByteArray</code> object does not include
	 *                   enough data to fill the area of the <code>rect</code>
	 *                   rectangle. The method fills as many pixels as possible
	 *                   before throwing the exception.
	 * @throws TypeError The rect or inputByteArray are null.
	 */
	public setPixels(rect: Rectangle, input: Uint8ClampedArray): void {
		this.dropAllReferences();

		//fast path for full imageData
		if (rect.equals(this._rect)) {
			this._data.set(input);
			this._unpackPMA = true;
		} else {
			const
				imageWidth: number = this._rect.width,
				inputWidth: number = rect.width,
				data: Uint8ClampedArray = this._data;

			for (let i = 0; i < rect.height; ++i)
				data.set(
					input.subarray(i * inputWidth * 4, (i + 1) * inputWidth * 4),
					(rect.x + (i + rect.y) * imageWidth) * 4);

			console.warn('[BitmapImage2D] Mixed texture mode - array should be a PMA.', this.id);
		}

		this.invalidateGPU();
	}

	/**
	 * Unlocks an image so that any objects that reference the BitmapImage2D object,
	 * such as Bitmap objects, are updated when this BitmapImage2D object changes.
	 * To improve performance, use this method along with the <code>lock()</code>
	 * method before and after numerous calls to the <code>setPixel()</code> or
	 * <code>setPixel32()</code> method.
	 *
	 * @param changeRect The area of the BitmapImage2D object that has changed. If
	 *                   you do not specify a value for this parameter, the
	 *                   entire area of the BitmapImage2D object is considered
	 *                   changed.
	 */
	public unlock(): void {
		if (!this._locked)
			return;

		this._locked = false;

		this.invalidate();
	}

	/**
	 * @inheritdoc
	 */
	set alphaChannel(buff: Uint8Array) {
		this.dropAllReferences();

		if (!buff) {
			return;
		}

		if (buff.length !== this.width * this.height) {
			throw (
				'error when trying to merge the alpha channel into the image.' +
				'the length of the alpha channel should be 1/4 of the length of the imageData');
		}

		// if assigments after initialiszation, apply it immediate
		if (this._data && this.wasUpload) {
			const buff = this._alphaChannel;

			for (let i = 0; i < buff.length; i++) {
				this._data[i * 4 + 3] = buff[i];
			}

			this._unpackPMA = false;
			this.invalidateGPU();

			return;
		}

		this._alphaChannel = buff;
		this._unpackPMA = false;
	}

	/**
	 *
	 * @returns {ImageData}
	 */
	public get data(): Uint8ClampedArray {
		return this.getDataInternal(true);
	}

	/**
	 *
	 * @param width
	 * @param height
	 * @private
	 */
	public _setSize(width: number, height: number): void {
		this.dropAllReferences();

		const data: Uint8ClampedArray = this.data;

		this._data = new Uint8ClampedArray(4 * width * height);

		const inputWidth: number = (this._rect.width < width) ? this._rect.width : width;
		const inputHeight: number = (this._rect.height < height) ? this._rect.height : height;

		for (let i = 0; i < inputHeight; ++i)
			this._data.set(data.subarray(i * inputWidth * 4, (i + 1) * inputWidth * 4), i * width * 4);

		super._setSize(width, height);
	}
}

import { Stage } from '../Stage';
import { ITexture } from '../base/ITexture';
import { ITextureBase } from '../base/ITextureBase';
import { BitmapImageUtils } from '../utils/BitmapImageUtils';

import { _Stage_Image2D } from './Image2D';
import { ContextWebGL } from '../webgl/ContextWebGL';

/**
 *
 * @class away.pool.ImageObjectBase
 */
export class _Stage_BitmapImage2D extends _Stage_Image2D {
	private onUnload = () =>{
		if (this._texture) {
			this._texture.dispose();
			this._texture = null;
			this._invalid = true;
			(<BitmapImage2D> this._asset).wasUpload = false;
		}
	}

	constructor(asset: IAsset, pool: Stage) {
		super(asset, pool);

		this._asset.addEventListener(BitmapImage2D.UNLOAD_EVENT, this.onUnload);
	}

	public onClear(event: AssetEvent) {
		this._asset.removeEventListener(BitmapImage2D.UNLOAD_EVENT, this.onUnload);
		super.onClear(event);
	}

	public getTexture(): ITextureBase {
		const asset = <BitmapImage2D> this._asset;
		const sourceBitmap = asset.sourceBitmap;

		if (sourceBitmap) {
			return (<_Stage_BitmapImage2D> sourceBitmap.getAbstraction(this._stage)).getTexture();
		}

		asset.markToUnload();
		super.getTexture();

		// not requred for empty buffer, becasue maybe RT that not has it by defalut
		const pixels = <Uint8ClampedArray>(asset.getDataInternal(false));

		const t = <ITexture> this._texture;

		if (!pixels) {
			// throw new Error('Invalid BitmapData state, pixles can\'t be null' + asset.id);
		}

		if (this._invalid && pixels) {
			t.uploadFromArray(new Uint8Array(pixels.buffer), 0, asset.unpackPMA);

			asset.wasUpload = true;

			const mipLevels = asset.mipLevels;
			if (mipLevels && mipLevels.length > 0) {

				for (let i = 0; i < mipLevels.length; i++) {
					t.uploadFromArray(
						new Uint8Array(mipLevels[i].data.buffer),
						i + 1,
						asset.transparent);
				}

				this._mipmap = true;
				this._invalidMipmaps = false;
			} else {
				this._invalidMipmaps = true;

			}

		}

		this._invalid = false;
		return this._texture;
	}
}

Stage.registerAbstraction(_Stage_BitmapImage2D, BitmapImage2D);