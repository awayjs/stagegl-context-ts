import { ContextWebGL } from './ContextWebGL';
import { VertexBufferWebGL } from './VertexBufferWebGL';
import { IndexBufferWebGL } from './IndexBufferWebGL';
import { ContextGLDrawMode } from '../base/ContextGLDrawMode';
import { ProgramWebGL } from './ProgramWebGL';
import { TextureWebGL } from './TextureWebGL';
import { ContextGLWrapMode } from '../base/ContextGLWrapMode';
import { ContextGLTextureFilter } from '../base/ContextGLTextureFilter';
import { ContextGLMipFilter } from '../base/ContextGLMipFilter';

const FRAG = `
    precision mediump float;
    precision mediump sampler2D;

    varying highp vec2 vUv;
    uniform sampler2D uTexture;

    void main () {
            gl_FragColor = texture2D(uTexture, vUv);
    }
`;

const VERT = `
precision highp float;

attribute vec2 aPosition;
varying vec2 vUv;

void main () {
        vUv = aPosition * 0.5 + 0.5;
        gl_Position = vec4(aPosition, 0.0, 1.0);
}
`
export class QUAD {
    gl: ContextWebGL;
    idxBuffer: IndexBufferWebGL;
    vtxBuffer: VertexBufferWebGL;
    valid: boolean;

    constructor(gl: ContextWebGL) {
        this.gl = gl;

		this.vtxBuffer = gl.createVertexBuffer(8, 2);
		this.idxBuffer = gl.createIndexBuffer(6);

		this.valid = false;
	}

	upload() {
        this.vtxBuffer.uploadFromArray(new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), 0, 8);
        this.idxBuffer.uploadFromArray(new Uint16Array([0, 1, 2, 0, 2, 3]), 0, 6);

		this.valid = true;
	}

	draw() {
        const gl = this.gl;
        
        gl.setVertexBufferAt(0, this.vtxBuffer);
        gl.drawIndices(ContextGLDrawMode.TRIANGLES, this.idxBuffer);
	}
}

export class Blitter {
    quad: QUAD;
    gl: ContextWebGL;
    prog: ProgramWebGL;

    constructor(gl:ContextWebGL) {
        this.gl = gl;
        this.quad = new QUAD(this.gl);
        this.quad.upload();

        this.prog = this.gl.createProgram();
        this.prog.name = "BLIT_TO_CANVAS";
        this.prog.uploadRaw(VERT, FRAG);
	}

	blit(source: TextureWebGL, ) {
		const gl = this.gl.gl();

        this.gl.disableDepth();
        this.gl.disableStencil();

        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        this.gl.setProgram(this.prog);
        this.gl.setSamplerStateAt(ContextWebGL.MAX_SAMPLERS - 1, 
            ContextGLWrapMode.CLAMP, 
            ContextGLTextureFilter.NEAREST, 
            ContextGLMipFilter.MIPNONE
        );

        this.gl.setTextureAt(ContextWebGL.MAX_SAMPLERS - 1, source);
		this.quad.draw();
	}
}
