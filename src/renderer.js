/* WebGL renderer: draws the character image as a texture mapped onto the
   deforming triangle mesh. Exposed on window.Renderer. */
(function () {
  const VERT = `
    attribute vec2 aPos;
    attribute vec2 aUV;
    attribute float aDepth;
    uniform vec2 uSize;
    uniform vec2 uScale;
    uniform vec2 uOffset;
    varying vec2 vUV;
    void main() {
      vec2 p = aPos * uScale + uOffset;
      vec2 c = p / uSize * 2.0 - 1.0;
      c.y = -c.y;
      // larger aDepth → nearer the viewer (more negative z passes the depth test)
      gl_Position = vec4(c, -aDepth * 0.1, 1.0);
      vUV = aUV;
    }`;

  const FRAG = `
    precision mediump float;
    varying vec2 vUV;
    uniform sampler2D uTex;
    void main() {
      vec4 col = texture2D(uTex, vUV);
      if (col.a < 0.35) discard;   // transparent texels must not occlude limbs
      gl_FragColor = col;
    }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('Shader: ' + gl.getShaderInfoLog(s));
    }
    return s;
  }

  function create(canvas) {
    const gl = canvas.getContext('webgl', {
      premultipliedAlpha: false, alpha: true, preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL not available');

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const aPos = gl.getAttribLocation(prog, 'aPos');
    const aUV = gl.getAttribLocation(prog, 'aUV');
    const aDepth = gl.getAttribLocation(prog, 'aDepth');
    const uSize = gl.getUniformLocation(prog, 'uSize');
    const uScale = gl.getUniformLocation(prog, 'uScale');
    const uOffset = gl.getUniformLocation(prog, 'uOffset');
    const uTex = gl.getUniformLocation(prog, 'uTex');

    const posBuf = gl.createBuffer();
    const uvBuf = gl.createBuffer();
    const depthBuf = gl.createBuffer();
    const idxBuf = gl.createBuffer();
    const tex = gl.createTexture();

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    const state = {
      count: 0, w: canvas.width, h: canvas.height,
      sx: 1, sy: 1, ox: 0, oy: 0,
    };

    function setStage(scale, ox, oy) {
      state.sx = state.sy = scale;
      state.ox = ox; state.oy = oy;
    }

    function setMesh(mesh, image, imgW, imgH) {
      // UVs from rest positions (same pixel space the image fills).
      const uvs = new Float32Array(mesh.verts.length * 2);
      for (let i = 0; i < mesh.verts.length; i++) {
        uvs[i * 2] = mesh.verts[i].x / imgW;
        uvs[i * 2 + 1] = mesh.verts[i].y / imgH;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);

      const idx = new Uint16Array(mesh.tris.length * 3);
      for (let i = 0; i < mesh.tris.length; i++) {
        idx[i * 3] = mesh.tris[i][0];
        idx[i * 3 + 1] = mesh.tris[i][1];
        idx[i * 3 + 2] = mesh.tris[i][2];
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      state.count = idx.length;

      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    function resize(w, h) {
      canvas.width = w; canvas.height = h;
      state.w = w; state.h = h;
    }

    function draw(positions, depths) {
      gl.viewport(0, 0, state.w, state.h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!state.count) return;

      gl.useProgram(prog);
      gl.uniform2f(uSize, state.w, state.h);
      gl.uniform2f(uScale, state.sx, state.sy);
      gl.uniform2f(uOffset, state.ox, state.oy);

      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      if (depths) {
        gl.bindBuffer(gl.ARRAY_BUFFER, depthBuf);
        gl.bufferData(gl.ARRAY_BUFFER, depths, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(aDepth);
        gl.vertexAttribPointer(aDepth, 1, gl.FLOAT, false, 0, 0);
      } else if (aDepth >= 0) {
        gl.disableVertexAttribArray(aDepth);
        gl.vertexAttrib1f(aDepth, 2.0);
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.enableVertexAttribArray(aUV);
      gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uTex, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
      gl.drawElements(gl.TRIANGLES, state.count, gl.UNSIGNED_SHORT, 0);
    }

    return { setMesh, draw, resize, setStage };
  }

  window.Renderer = { create };
})();
