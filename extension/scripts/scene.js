// Procedural landscapes: entirely local, with no downloaded assets.
export class Landscape {
  constructor(canvas, { preview = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scene = 'aurora';
    this.running = false;
    this.time = 0;
    this.speed = 1;
    this.previous = 0;
    let seed = 42;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    this.stars = Array.from({ length: 160 }, () => [
      random(),
      random() * 0.73,
      random(),
      random() * 6,
    ]);
    this.resize = () => {
      const scale = Math.min(1.25, 1800 / innerWidth);
      canvas.width = preview ? 360 : Math.round(innerWidth * scale);
      canvas.height = preview ? 230 : Math.round(innerHeight * scale);
      this.draw();
    };
    if (!preview) addEventListener('resize', this.resize);
    this.resize();
  }
  setScene(scene) {
    this.scene = scene;
    this.draw();
  }
  setRunning(running) {
    if (running === this.running) return;
    this.running = running;
    cancelAnimationFrame(this.frame);
    this.previous = 0;
    if (running) this.frame = requestAnimationFrame((t) => this.tick(t));
  }
  tick(now) {
    if (!this.running) return;
    if (!this.previous || now - this.previous >= 40) {
      this.time += this.previous ? (Math.min(now - this.previous, 100) / 1000) * this.speed : 0;
      this.previous = now;
      this.draw();
    }
    this.frame = requestAnimationFrame((t) => this.tick(t));
  }
  draw() {
    const c = this.ctx,
      w = this.canvas.width,
      h = this.canvas.height,
      t = this.time;
    if (!w || !h) return;
    const colors = {
      aurora: ['#050f22', '#163d4a', '#81ada1'],
      dusk: ['#30283f', '#b07582', '#f3bd85'],
      ocean: ['#081d33', '#235e76', '#79bfc0'],
    }[this.scene];
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, colors[0]);
    sky.addColorStop(0.53, colors[1]);
    sky.addColorStop(1, colors[2]);
    c.fillStyle = sky;
    c.fillRect(0, 0, w, h);
    if (this.scene !== 'dusk') {
      for (const [x, y, r, phase] of this.stars) {
        c.fillStyle = `rgba(224,242,239,${(0.18 + r * 0.48) * (0.8 + Math.sin(t * 0.4 + phase) * 0.2)})`;
        c.beginPath();
        c.arc(x * w, y * h, 0.4 + r * 0.85, 0, Math.PI * 2);
        c.fill();
      }
    }
    if (this.scene === 'aurora') {
      c.save();
      c.globalCompositeOperation = 'screen';
      for (let band = 0; band < 3; band++) {
        for (let x = -20; x < w + 20; x += 6) {
          const u = x / w;
          const y =
            h *
            (0.19 +
              band * 0.105 +
              0.11 * Math.sin(u * 5 + t * 0.1 + band * 1.1) +
              0.035 * Math.sin(u * 12 - t * 0.14));
          const height = h * (0.24 + 0.06 * Math.sin(u * 9 + t * 0.12));
          const glow = c.createLinearGradient(0, y - height, 0, y + height * 0.25);
          const strength =
            (0.18 + 0.1 * Math.sin(u * 17 + band + t * 0.25)) * (band === 0 ? 1 : 0.55);
          const rgb = band === 2 ? '137,147,240' : '113,239,176';
          glow.addColorStop(0, `rgba(${rgb},0)`);
          glow.addColorStop(0.65, `rgba(${rgb},${strength * 0.6})`);
          glow.addColorStop(0.82, `rgba(${rgb},${strength})`);
          glow.addColorStop(1, `rgba(${rgb},0)`);
          c.fillStyle = glow;
          c.fillRect(x, y - height, 6, height * 1.25);
        }
      }
      c.restore();
    }
    // A luminous moon or sun sits off-center, leaving the clock readable.
    const sx = w * 0.76,
      sy = h * (this.scene === 'dusk' ? 0.45 : 0.22);
    const halo = c.createRadialGradient(sx, sy, 0, sx, sy, h * 0.27);
    halo.addColorStop(0, this.scene === 'dusk' ? '#ffd3a160' : '#cae8e518');
    halo.addColorStop(1, '#dbeacb00');
    c.fillStyle = halo;
    c.fillRect(0, 0, w, h);
    if (this.scene === 'dusk') {
      for (let i = 0; i < 4; i++) {
        const cx = (((i * 0.32 + t * 0.003) % 1.4) - 0.2) * w;
        c.save();
        c.translate(cx, h * (0.2 + i * 0.085));
        c.scale(4, 0.45);
        const cloud = c.createRadialGradient(0, 0, 0, 0, 0, h * 0.12);
        cloud.addColorStop(0, '#f7c3ad14');
        cloud.addColorStop(1, '#f7c3ad00');
        c.fillStyle = cloud;
        c.fillRect(-h * 0.12, -h * 0.12, h * 0.24, h * 0.24);
        c.restore();
      }
    }
    c.fillStyle = this.scene === 'dusk' ? '#ffe0b2' : '#d7e7d9';
    c.beginPath();
    c.arc(sx, sy, h * (this.scene === 'dusk' ? 0.036 : 0.013), 0, Math.PI * 2);
    c.fill();
    if (this.scene === 'ocean') {
      for (let layer = 0; layer < 9; layer++) {
        const base = h * (0.64 + layer * 0.048);
        c.beginPath();
        c.moveTo(0, h);
        for (let x = 0; x <= w + 12; x += 12) {
          c.lineTo(
            x,
            base +
              Math.sin((x / w) * 10 + t * (0.14 + layer * 0.025) + layer) * h * 0.014 +
              Math.sin((x / w) * 19 - t * 0.17) * h * 0.005,
          );
        }
        c.lineTo(w, h);
        c.closePath();
        c.fillStyle = `hsl(${192 + layer * 2} 43% ${30 - layer * 2.4}%)`;
        c.fill();
        c.strokeStyle = '#a9ded51c';
        c.lineWidth = 1;
        c.stroke();
      }
    } else {
      // Multiple irregular ridgelines give the scene depth without image files.
      const ridges = [
        [0.68, 0.57, 0.63, 0.44, 0.56, 0.66, 0.6, 0.68, 0.55, 0.62, 0.53, 0.66, 0.59, 0.69],
        [0.73, 0.65, 0.69, 0.61, 0.72, 0.68, 0.76, 0.66, 0.73, 0.64, 0.72, 0.62, 0.72, 0.76],
        [0.78, 0.75, 0.82, 0.74, 0.81, 0.84, 0.77, 0.84, 0.81, 0.87, 0.79, 0.84, 0.8, 0.87],
        [0.91, 0.87, 0.88, 0.9, 0.85, 0.9, 0.92, 0.88, 0.93, 0.92, 0.87, 0.91, 0.92, 0.93],
      ];
      const shades =
        this.scene === 'dusk'
          ? ['#685b72', '#45465f', '#2e3449', '#172735']
          : ['#284a58', '#1b3947', '#122d37', '#091e27'];
      ridges.forEach((points, layer) => {
        c.beginPath();
        c.moveTo(-10, h);
        points.forEach((y, i) => c.lineTo((i / (points.length - 1)) * w, y * h));
        c.lineTo(w + 10, h);
        c.closePath();
        c.fillStyle = shades[layer];
        c.fill();
      });
      const mist = c.createLinearGradient(0, h * 0.67, 0, h);
      mist.addColorStop(0, '#9ebcb300');
      mist.addColorStop(0.4, this.scene === 'dusk' ? '#c9a39c10' : '#a2c8b80b');
      mist.addColorStop(1, '#01172200');
      c.fillStyle = mist;
      c.fillRect(0, h * 0.67, w, h * 0.33);
    }
  }
}
