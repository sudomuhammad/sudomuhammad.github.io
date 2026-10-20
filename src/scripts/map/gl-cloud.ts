// WebGL renderer for the map's particle cloud: soft round points, one draw
// call per frame. It only draws; positions come from the physics in
// embedding-map.ts. Returns null when WebGL isn't available, so the caller
// can fall back to Canvas 2D.

export interface GlCloud {
  resize: (width: number, height: number, dpr: number) => void;
  /**
   * Draw particles [from, to). `x`/`y` are CSS pixels; `group` indexes `colors`;
   * `alpha` is the per-group opacity.
   */
  draw: (
    x: Float32Array,
    y: Float32Array,
    group: Int16Array,
    from: number,
    to: number,
    alpha: Float32Array,
    pointSize: number,
  ) => void;
  clear: () => void;
}

const VERTEX = `
  attribute vec2 a_pos;
  attribute float a_group;
  uniform vec2 u_res;
  uniform float u_size;
  varying float v_group;
  void main() {
    vec2 clip = (a_pos / u_res) * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    gl_PointSize = u_size;
    v_group = a_group;
  }
`;

// Colours and opacities are looked up per group; WebGL 1 can't index uniform
// arrays with a varying, hence the small loop.
const FRAGMENT = (groups: number) => `
  precision mediump float;
  uniform vec3 u_colors[${groups}];
  uniform float u_alpha[${groups}];
  varying float v_group;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d);
    if (r > 0.5) discard;
    vec3 color = vec3(0.0);
    float alpha = 0.0;
    for (int i = 0; i < ${groups}; i++) {
      if (abs(float(i) - v_group) < 0.5) {
        color = u_colors[i];
        alpha = u_alpha[i];
      }
    }
    float soft = smoothstep(0.5, 0.15, r);
    gl_FragColor = vec4(color * soft * alpha, soft * alpha);
  }
`;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
  return shader;
}

export function createGlCloud(canvas: HTMLCanvasElement, colors: string[], capacity: number): GlCloud | null {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true });
  if (!gl) return null;

  let program: WebGLProgram;
  try {
    program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT(colors.length)));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  } catch {
    return null;
  }
  gl.useProgram(program);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha

  const positions = new Float32Array(capacity * 2);
  const groups = new Float32Array(capacity);
  const posBuffer = gl.createBuffer();
  const groupBuffer = gl.createBuffer();
  const aPos = gl.getAttribLocation(program, 'a_pos');
  const aGroup = gl.getAttribLocation(program, 'a_group');
  const uRes = gl.getUniformLocation(program, 'u_res');
  const uSize = gl.getUniformLocation(program, 'u_size');
  const uAlpha = gl.getUniformLocation(program, 'u_alpha');
  gl.uniform3fv(gl.getUniformLocation(program, 'u_colors'), colors.flatMap(hexToRgb));

  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, groupBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, groups.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(aGroup);
  gl.vertexAttribPointer(aGroup, 1, gl.FLOAT, false, 0, 0);

  let dpr = 1;
  let groupsUploaded = false;

  return {
    resize(width, height, ratio) {
      dpr = ratio;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, width, height);
    },
    clear() {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    draw(x, y, group, from, to, alpha, pointSize) {
      const n = to - from;
      for (let i = 0; i < n; i++) {
        positions[i * 2] = x[from + i];
        positions[i * 2 + 1] = y[from + i];
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions.subarray(0, n * 2));
      if (!groupsUploaded) {
        for (let i = 0; i < n; i++) groups[i] = group[from + i];
        gl.bindBuffer(gl.ARRAY_BUFFER, groupBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, groups.subarray(0, n));
        groupsUploaded = true; // groups never change
      }
      gl.uniform1f(uSize, pointSize * dpr);
      gl.uniform1fv(uAlpha, alpha);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, n);
    },
  };
}
