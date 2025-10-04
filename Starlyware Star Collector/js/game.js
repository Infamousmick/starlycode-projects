/*
  Project: Starlyware Star Collector
  Author: Gianluca Grasso (https://github.com/gian-grasso)
  License: http://www.apache.org/licenses/LICENSE-2.0
*/

(function(){
  'use strict';

  /* ---------- CONFIG ---------- */
  const COLOR = "#007FFF";
  const INITIAL_LIVES = 3;
  const MAX_LEVEL = 6;

  //Spawn and speed base values
  const STAR_SPAWN_BASE = 0.9;
  const METEOR_SPAWN_BASE = 0.35;
  const POWERUP_SPAWN_BASE = 0.06;
  const STAR_SPEED_BASE = 90;
  const METEOR_SPEED_BASE = 150;

  /* ---------- STATE ---------- */
  let canvas, ctx, W, H, dpr;
  let lastTime = 0, rafId;
  let player = { x:0, y:0, w:46, h:34, vx:0, speed:420, invincible:false, turbo:false, _invT:0, _turboT:0 };
  let stars = [], meteors = [], powerups = [], particles = [];
  let score = 0, level = 1, lives = INITIAL_LIVES, timeElapsed = 0;
  let spawnTimers = { stars:0, meteors:0, powerups:0 };
  let gameRunning = false, gamePaused = false;
  let highscore = parseInt(localStorage.getItem("starly_highscore") || "0", 10);
  let audioCtx = null;

  //UI refs
  let elScore, elLevel, elLives, elHighscore, elOverlay, elStartBtn, elPauseBtn, elRestartBtn;

  /* ---------- AUDIO TONES ---------- */
  function audioInit(){
    if(audioCtx) return;
    try{ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e){ audioCtx = null; }
  }
  function playTone(frequency, time=0.12, vol=0.08, type='sine'){
    if(!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = frequency;
    g.gain.value = vol;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + time);
  }
  function playMatch(){ playTone(880,0.12,0.08,'sine'); playTone(1320,0.06,0.06,'sine'); }
  function playWrong(){ playTone(140,0.18,0.08,'triangle'); }
  function playWin(){ playTone(660,0.18,0.09,'sine'); playTone(880,0.18,0.07,'sine'); }

  /* ---------- UTIL ---------- */
  const rand = (a,b) => Math.random()*(b-a)+a;
  const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
  const now = () => performance.now()/1000;

  /* ---------- CANVAS INIT ---------- */
  function initCanvas(){
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d', { alpha: true });
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
  }
  function resizeCanvas(){
    if(!canvas) return;
    const rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(320, Math.floor(rect.width));
    H = Math.max(240, Math.floor(rect.height));
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  /* ---------- DRAW HELPERS ---------- */
  function drawRoundedRect(x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r);
    ctx.arcTo(x,y,x+w,y,r);
    ctx.closePath();
    ctx.fill();
  }

  //SDraw a 5-point star at x,y with outer radius R and inner r
  function drawStarShape(x,y,R,r, fillStyle, shadow){
    ctx.save();
    if(shadow){ ctx.shadowColor = shadow.color; ctx.shadowBlur = shadow.blur; }
    ctx.beginPath();
    for(let i=0;i<5;i++){
      const a = (i*2*Math.PI)/5 - Math.PI/2;
      const ax = x + Math.cos(a)*R;
      const ay = y + Math.sin(a)*R;
      ctx.lineTo(ax,ay);
      const a2 = a + Math.PI/5;
      const bx = x + Math.cos(a2)*r;
      const by = y + Math.sin(a2)*r;
      ctx.lineTo(bx,by);
    }
    ctx.closePath();
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.restore();
  }

  function drawMeteorShape(x,y,r, angle){
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(angle);
    ctx.beginPath();
    //Rough irregular polygon
    ctx.moveTo(-r*0.6, -r*0.3);
    ctx.quadraticCurveTo(-r*0.2, -r*0.9, r*0.5, -r*0.6);
    ctx.quadraticCurveTo(r*0.9, -r*0.3, r*0.6, r*0.2);
    ctx.quadraticCurveTo(r*0.2, r*0.9, -r*0.7, r*0.6);
    ctx.closePath();
    //Rocky gradient
    const g = ctx.createLinearGradient(-r,r,r,-r);
    g.addColorStop(0, '#d3d3d3'); g.addColorStop(1, '#8f8f8f');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  /* ---------- SPAWNERS ---------- */
  function spawnStar(){
    const R = rand(14, 22); //Outer radius
    stars.push({
      x: rand(R, W-R),
      y: -R*1.5,
      R: R,
      r: R*0.45,
      vy: STAR_SPEED_BASE + (level-1)*18 + rand(-6,18),
      score: 10 + (level-1)*5,
      special: Math.random() < 0.12,
      sparkle: Math.random()*100
    });
  }
  function spawnMeteor(){
    const r = rand(18,40);
    meteors.push({
      x: rand(r, W-r),
      y: -r*1.5,
      r: r,
      vy: METEOR_SPEED_BASE + (level-1)*20 + rand(-20,40),
      ang: rand(0, Math.PI*2),
      vr: rand(-2,2)
    });
  }
  function spawnPowerup(){
    const types = ['inv','turbo','bonus'];
    powerups.push({
      x: rand(30, W-30),
      y: -20,
      r: 14,
      vy: 90 + level*8,
      type: types[Math.floor(rand(0, types.length))]
    });
  }

  /* ---------- PARTICLES (background & effects) ---------- */
  function spawnBgParticles(){
    for(let i=0;i<40;i++){
      particles.push({
        x: Math.random()*W,
        y: Math.random()*H,
        r: Math.random()*1.6 + 0.5,
        vy: Math.random()*6 + 2,
        alpha: Math.random()*0.6 + 0.1
      });
    }
  }
  function spawnCollectParticles(x,y, color){
    for(let i=0;i<12;i++){
      particles.push({
        x, y,
        vx: Math.cos(i/12*Math.PI*2)*rand(30,120),
        vy: Math.sin(i/12*Math.PI*2)*rand(30,120),
        r: rand(1.2,3.2),
        life: 0,
        maxLife: rand(0.5,0.9),
        color: color || COLOR
      });
    }
  }

  function updateParticles(dt){
    for(let i=particles.length-1;i>=0;i--){
      const p = particles[i];
      if(p.maxLife){
        p.life += dt;
        p.x += (p.vx||0)*dt;
        p.y += (p.vy||0)*dt;
        const t = p.life/p.maxLife;
        if(t>1) particles.splice(i,1);
      } else {
        p.y += p.vy*dt;
        if(p.y > H + 10) p.y = -10;
      }
    }
  }
  function drawParticles(){
    for(const p of particles){
      if(p.maxLife){
        const alpha = 1 - p.life/p.maxLife;
        ctx.fillStyle = hexToRgba(p.color || COLOR, alpha);
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
      } else {
        ctx.fillStyle = hexToRgba('#ffffff', p.alpha*0.6);
        ctx.fillRect(p.x, p.y, p.r, p.r);
      }
    }
  }

  /* ---------- PLAYER (draw + update) ---------- */
  function drawPlayer(){
    const { x, y, w, h } = player;
    // trail
    ctx.save();
    const g = ctx.createLinearGradient(x - w, y + h, x + w, y - h);
    g.addColorStop(0, 'rgba(0,127,255,0.02)');
    g.addColorStop(1, 'rgba(0,127,255,0.12)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y + h*0.7, w*1.2, h*0.6, 0, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    //Ship body
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.beginPath();
    ctx.moveTo(0, -h*0.5);
    ctx.lineTo(w*0.6, h*0.6);
    ctx.lineTo(-w*0.6, h*0.6);
    ctx.closePath();
    const grad = ctx.createLinearGradient(-w, -h, w, h);
    grad.addColorStop(0, COLOR);
    grad.addColorStop(1, '#00b3ff');
    ctx.fillStyle = grad;
    ctx.fill();

    //Outline
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.stroke();
    ctx.restore();
  }
  function updatePlayer(dt){
    player.x += player.vx * dt;
    player.x = clamp(player.x, player.w/2, W - player.w/2);
  }

  /* ---------- COLLISION HELPERS ---------- */
  function rectCircleCollide(cx, cy, cr, rx, ry, rw, rh){
    const nearestX = Math.max(rx - rw/2, Math.min(cx, rx + rw/2));
    const nearestY = Math.max(ry - rh/2, Math.min(cy, ry + rh/2));
    const dx = cx - nearestX; const dy = cy - nearestY;
    return (dx*dx + dy*dy) <= cr*cr;
  }

  /* ---------- UPDATE ---------- */
  function update(dt){
    timeElapsed += dt;
    //Spawn timers
    spawnTimers.stars += dt; spawnTimers.meteors += dt; spawnTimers.powerups += dt;
    const starInterval = 1 / (STAR_SPAWN_BASE + (level-1)*0.25);
    const meteorInterval = 1 / (METEOR_SPAWN_BASE + (level-1)*0.06);
    const powerupInterval = 1 / (POWERUP_SPAWN_BASE + (level-1)*0.01);

    if(spawnTimers.stars >= starInterval){ spawnTimers.stars = 0; spawnStar(); }
    if(spawnTimers.meteors >= meteorInterval){ spawnTimers.meteors = 0; if(Math.random()<0.9) spawnMeteor(); }
    if(spawnTimers.powerups >= powerupInterval){ spawnTimers.powerups = 0; if(Math.random()<0.5) spawnPowerup(); }

    //Update stars
    for(let i=stars.length-1;i>=0;i--){
      const s = stars[i];
      s.y += s.vy * dt;
      s.sparkle += dt*60;
      //Collision
      if(rectCircleCollide(s.x, s.y, s.R*0.7, player.x, player.y, player.w, player.h)){
        if(s.special) applyPowerup({ type: 'bonus' });
        score += s.score;
        playMatch();
        spawnCollectParticles(s.x, s.y, COLOR);
        stars.splice(i,1);
        updateHUD();
        if(score > level * 150 + (level-1)*40) levelUp();
        continue;
      }
      if(s.y - s.R > H + 50) stars.splice(i,1);
    }

    //Meteors
    for(let i=meteors.length-1;i>=0;i--){
      const m = meteors[i];
      m.y += m.vy * dt; m.ang += m.vr*dt*0.6;
      if(!player.invincible && rectCircleCollide(m.x, m.y, m.r*0.7, player.x, player.y, player.w, player.h)){
        meteors.splice(i,1);
        lives--;
        playWrong();
        flashDamage();
        updateHUD();
        if(lives <= 0){ endGame(); return; }
      } else if(player.invincible && rectCircleCollide(m.x, m.y, m.r*0.7, player.x, player.y, player.w, player.h)){
        meteors.splice(i,1); score += 20; playMatch(); updateHUD();
      } else if(m.y - m.r > H + 50) meteors.splice(i,1);
    }

    //Pwrups
    for(let i=powerups.length-1;i>=0;i--){
      const p = powerups[i];
      p.y += p.vy * dt;
      if(rectCircleCollide(p.x, p.y, p.r, player.x, player.y, player.w, player.h)){
        applyPowerup(p); powerups.splice(i,1); updateHUD(); continue;
      }
      if(p.y - p.r > H + 50) powerups.splice(i,1);
    }

    //Update particles
    updateParticles(dt);

    //Player
    updatePlayer(dt);

    //Powerup timers
    if(player.invincible){ player._invT -= dt; if(player._invT <= 0) player.invincible = false; }
    if(player.turbo){ player._turboT -= dt; if(player._turboT <= 0){ player.turbo = false; player.speed = 420; } }

    //Difficulty increase
    if(timeElapsed > level * 25 && level < MAX_LEVEL){
      level++; updateHUD(); playTone(700,0.08,0.06);
    }
  }

  /* ---------- APPLY POWERUP ---------- */
  function applyPowerup(p){
    const t = p.type || (Math.random() < 0.5 ? 'inv' : 'bonus');
    if(t === 'inv'){ player.invincible = true; player._invT = 5 + level*1.0; playMatch(); }
    else if(t === 'turbo'){ player.turbo = true; player._turboT = 4 + level*0.8; player.speed = 640; playMatch(); }
    else { const bonus = 30 + level*10; score += bonus; playMatch(); spawnCollectParticles(player.x, player.y, '#ffd700'); }
  }

  /* ---------- RENDER ---------- */
  function render(){
    if(!ctx) return;
    ctx.clearRect(0,0,W,H);

    //Subtle gradient background
    const bg = ctx.createLinearGradient(0,0,0,H);
    bg.addColorStop(0, 'rgba(0,0,0,0.28)');
    bg.addColorStop(1, 'rgba(0,0,0,0.56)');
    ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);

    //Starry particles
    drawParticles();

    //Draw stars
    for(const s of stars){
      if(s.special){
        drawStarShape(s.x, s.y, s.R, s.r, '#ffd66b', { color: 'rgba(255,214,107,0.18)', blur: 18 });
      }
    //Starlyware Star (with love)
      drawStarShape(s.x, s.y, s.R, s.r, COLOR, { color: 'rgba(0,127,255,0.14)', blur: 16 });
    }

    //Meteors
    for(const m of meteors){
      drawMeteorShape(m.x, m.y, m.r, m.ang);
      //Small trail
      ctx.strokeStyle = 'rgba(255,200,120,0.06)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(m.x, m.y - m.r*0.2); ctx.lineTo(m.x - m.vy*0.02, m.y - m.r*0.2 - 20); ctx.stroke();
    }

    //Powerups: circular icon with symbol
    for(const p of powerups){
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = (p.type === 'inv') ? '#ffd700' : (p.type === 'turbo' ? '#00ffcc' : '#cfa3ff');
      ctx.fill();
      ctx.fillStyle = '#111'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const label   = (p.type === 'inv' ? '\u2605' : (p.type === 'turbo' ? '\u26A1' : '+'));
      ctx.fillText(label, p.x, p.y+1);
    }

    //Draw player on top
    drawPlayer();

    //Damage flash overlay
    if(window.flashAlpha && window.flashAlpha > 0){
      ctx.fillStyle = `rgba(255,40,40,${window.flashAlpha})`; ctx.fillRect(0,0,W,H);
    }
  }

  function drawParticles(){
    for(const p of particles){
      if(p.maxLife){
        const alpha = 1 - (p.life/p.maxLife);
        ctx.fillStyle = hexToRgba(p.color || COLOR, alpha);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
      } else {
        ctx.fillStyle = hexToRgba('#ffffff', p.alpha*0.6); ctx.fillRect(p.x, p.y, p.r, p.r);
      }
    }
  }

  /* ---------- MAIN LOOP ---------- */
  function loop(t){
    if(!lastTime) lastTime = t;
    const dt = Math.min(0.05, (t - lastTime)/1000);
    lastTime = t;
    if(gameRunning && !gamePaused) update(dt);
    render();
    rafId = requestAnimationFrame(loop);
  }

  /* ---------- CONTROLS (keyboard + drag) ---------- */
  function setupControls(){
    window.addEventListener('keydown', e => {
      if(e.key === 'ArrowLeft' || e.key === 'a'){ player.vx = -player.speed; window.keyLeft = true; }
      if(e.key === 'ArrowRight' || e.key === 'd'){ player.vx = player.speed; window.keyRight = true; }
      if(e.key === ' '){ togglePause(); }
    });
    window.addEventListener('keyup', e => {
      if(e.key === 'ArrowLeft' || e.key === 'a'){ window.keyLeft = false; if(!window.keyRight) player.vx = 0; else player.vx = player.speed; }
      if(e.key === 'ArrowRight' || e.key === 'd'){ window.keyRight = false; if(!window.keyLeft) player.vx = 0; else player.vx = -player.speed; }
    });

    //Touch / mouse drag
    let dragging = false, offsetX = 0;
    function startDrag(clientX){
      dragging = true;
      const rect = canvas.getBoundingClientRect();
      const cx = clientX - rect.left;
      offsetX = player.x - cx;
    }
    function moveDrag(clientX){
      if(!dragging) return;
      const rect = canvas.getBoundingClientRect();
      const cx = clientX - rect.left;
      player.x = clamp(cx + offsetX, player.w/2, W - player.w/2);
    }
    function endDrag(){ dragging = false; }

    canvas.addEventListener('mousedown', e => startDrag(e.clientX));
    canvas.addEventListener('mousemove', e => moveDrag(e.clientX));
    window.addEventListener('mouseup', endDrag);

    canvas.addEventListener('touchstart', e => startDrag(e.touches[0].clientX), {passive:true});
    canvas.addEventListener('touchmove', e => moveDrag(e.touches[0].clientX), {passive:true});
    window.addEventListener('touchend', endDrag);
  }

  /* ---------- UI & HUD ---------- */
  function updateHUD(){
    if(elScore) elScore.textContent = String(score);
    if(elLevel) elLevel.textContent = String(level);
    if(elLives) elLives.textContent = String(lives);
    if(elHighscore) elHighscore.textContent = String(highscore);
  }

  function levelUp(){
    level++;
    if(elLevel) elLevel.textContent = level;
    playTone(600,0.08,0.06);
    //Small pulse on canvas
    canvas.classList.add('glow');
    setTimeout(()=>canvas.classList.remove('glow'), 300);
  }

  function endGame(){
    gameRunning = false;
    cancelAnimationFrame(rafId);
    if(score > highscore){ highscore = score; localStorage.setItem('starly_highscore', String(highscore)); }
    if(elHighscore) elHighscore.textContent = String(highscore);
    if(elOverlay){
      elOverlay.classList.remove('hidden');
      document.getElementById('overlay-title').textContent = 'Game Over';
      document.getElementById('overlay-msg').textContent = `You scored ${score} points.`;
      document.getElementById('overlay-start').textContent = 'Play Again';
    }
    playWin();
  }

  /* ---------- EFFECTS ---------- */
  window.flashAlpha = 0;
  function flashDamage(){
    window.flashAlpha = 0.6;
    const fade = setInterval(()=>{ window.flashAlpha -= 0.08; if(window.flashAlpha <= 0){ window.flashAlpha = 0; clearInterval(fade);} }, 50);
  }

  function spawnCollectParticles(x,y, color){
    for(let i=0;i<14;i++){
      particles.push({
        x, y,
        vx: Math.cos(i/14*Math.PI*2)*rand(40,160),
        vy: Math.sin(i/14*Math.PI*2)*rand(40,160),
        r: rand(1.4,3.8),
        life: 0,
        maxLife: rand(0.4,0.9),
        color: color || COLOR
      });
    }
  }

  /* ---------- START / PAUSE / RESTART ---------- */
  function startGame(){
    audioInit();
    if(!gameRunning){
      gameRunning = true; gamePaused = false;
      lastTime = 0; score = 0; lives = INITIAL_LIVES; level = 1; timeElapsed = 0;
      player.x = W/2; player.y = H - 60; player.vx = 0;
      stars = []; meteors = []; powerups = []; particles = [];
      spawnTimers = { stars:0, meteors:0, powerups:0 };
      for(let i=0;i<6;i++) spawnStar();
      updateHUD();
      rafId = requestAnimationFrame(loop);
    } else {
      gamePaused = false;
    }
  }
  function togglePause(){ if(!gameRunning) return; gamePaused = !gamePaused; }
  function restartGame(){ gameRunning = false; cancelAnimationFrame(rafId); startGame(); }

  /* ---------- INIT wrapper ---------- */
  function freshInit(){
    spawnTimers = { stars:0, meteors:0, powerups:0 };
    particles = []; spawnBgParticles();
    stars = []; meteors = []; powerups = [];
    for(let i=0;i<4;i++) spawnStar();
    updateHUD(); render();
  }

  /* ---------- UI wiring ---------- */
  function setupUI(){
    elScore = document.getElementById('score');
    elLevel = document.getElementById('level');
    elLives = document.getElementById('lives');
    elHighscore = document.getElementById('highscore');
    elOverlay = document.getElementById('overlay');

    elStartBtn = document.getElementById('startBtn');
    elPauseBtn = document.getElementById('pauseBtn');
    elRestartBtn = document.getElementById('restartBtn');

    if(elStartBtn) elStartBtn.addEventListener('click', ()=>{ if(elOverlay) elOverlay.classList.add('hidden'); startGame(); });
    if(elPauseBtn) elPauseBtn.addEventListener('click', ()=> togglePause());
    if(elRestartBtn) elRestartBtn.addEventListener('click', ()=> restartGame());

    const overlayStart = document.getElementById('overlay-start');
    const overlayClose = document.getElementById('overlay-close');
    if(overlayStart) overlayStart.addEventListener('click', ()=>{ if(elOverlay) elOverlay.classList.add('hidden'); restartGame(); });
    if(overlayClose) overlayClose.addEventListener('click', ()=>{ if(elOverlay) elOverlay.classList.add('hidden'); });

    if(elHighscore) elHighscore.textContent = String(highscore);
  }

  /* ---------- BOOT ---------- */
  document.addEventListener('DOMContentLoaded', ()=>{
    try{
      initCanvas();
      setupControls();
      setupUI();
      audioInit();
      player.x = (W||900)/2; player.y = (H||600)-60;
      freshInit();
      render();
      console.log("Starlyware booted. Highscore:", highscore);
    }catch(err){ console.error("Boot error:", err); }
  });

  /* ---------- HELPERS ---------- */
  function hexToRgba(hex, alpha=1){
    const h = hex.replace('#','');
    const bigint = parseInt(h,16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  //Expose debug
  window._starly_debug = { startGame, restartGame, togglePause, getState: ()=>({score,level,lives,gameRunning}) };

})();