let stream = null;
let audioCtx = null;
let analyserL = null;
let analyserR = null;
let loopsRunning = false;
let devicesNeedPermission = false; // true when device entries exist but have no real deviceId (permission not yet granted)

const videoSel   = document.getElementById('videoDevices');
const audioSel   = document.getElementById('audioDevices');
const resSel     = document.getElementById('resolution');
const startBtn   = document.getElementById('startBtn');
const refreshBtn = document.getElementById('refreshBtn');
const shutdownBtn = document.getElementById('shutdownBtn');
const fsBtn      = document.getElementById('fsBtn');
const video      = document.getElementById('screen');
const overlay    = document.getElementById('overlay');
const tally      = document.getElementById('tally');
const tallyLabel = document.getElementById('tallyLabel');
const hudRes     = document.getElementById('hudRes');
const hudFps     = document.getElementById('hudFps');
const roDevice   = document.getElementById('roDevice');
const statusLine = document.getElementById('statusLine');
const meterL     = document.getElementById('meterL');
const meterR     = document.getElementById('meterR');
const dbL        = document.getElementById('dbL');
const dbR        = document.getElementById('dbR');
const viewportWrap = document.getElementById('viewportWrap');

function setStatus(msg, kind){
  statusLine.textContent = msg;
  statusLine.className = 'status-line' + (kind ? ' ' + kind : '');
}

function tickClock(){
  const now = new Date();
  document.getElementById('clock').textContent = now.toLocaleTimeString('en-GB', { hour12:false });
}
setInterval(tickClock, 1000);
tickClock();

function parseResolution(val){
  if(val === 'native') return null;
  const [w,h,f] = val.split('x').map(Number);
  return { width:w, height:h, frameRate:f };
}

async function listDevices(){
  refreshBtn.classList.add('spin');
  try{
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videos = devices.filter(d => d.kind === 'videoinput');
    const audios = devices.filter(d => d.kind === 'audioinput');

    const prevVideo = videoSel.value;
    const prevAudio = audioSel.value;

    videoSel.innerHTML = '';
    audioSel.innerHTML = '';

    videos.forEach((d,i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.text = d.label || ('Video Input ' + (i+1));
      videoSel.appendChild(o);
    });

    audios.forEach((d,i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.text = d.label || ('Audio Input ' + (i+1));
      audioSel.appendChild(o);
    });

    const savedVideo = localStorage.getItem('capture.videoId');
    const savedAudio = localStorage.getItem('capture.audioId');

    if(savedVideo && videos.some(d => d.deviceId === savedVideo)) videoSel.value = savedVideo;
    else if(prevVideo && videos.some(d => d.deviceId === prevVideo)) videoSel.value = prevVideo;

    if(savedAudio && audios.some(d => d.deviceId === savedAudio)) audioSel.value = savedAudio;
    else if(prevAudio && audios.some(d => d.deviceId === prevAudio)) audioSel.value = prevAudio;

    // Without granted permission, the browser still lists entries (so the
    // dropdown looks populated) but every deviceId comes back as "" —
    // there's no real ID behind the label yet. Detect that directly instead
    // of letting it surface later as a confusing "select a device" error.
    devicesNeedPermission = videos.length > 0 && videos.every(d => !d.deviceId);

    if(devicesNeedPermission){
      setStatus('Devices listed, but camera permission isn\'t granted yet — allow camera access for this site, then click refresh.', 'err');
    } else {
      setStatus(videos.length ? 'Devices ready — select input and start capture.' : 'No video input devices found.', videos.length ? '' : 'err');
    }
  } catch(e){
    setStatus('Could not list devices: ' + e.message, 'err');
  } finally {
    setTimeout(() => refreshBtn.classList.remove('spin'), 350);
  }
}

function stopStream(){
  loopsRunning = false;
  if(audioCtx){ audioCtx.close().catch(()=>{}); audioCtx = null; analyserL = null; analyserR = null; }
  if(stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.srcObject = null;
  overlay.style.opacity = '1';
  tally.classList.remove('live');
  tallyLabel.textContent = 'STANDBY';
  hudRes.textContent = '—';
  hudFps.textContent = '—';
  meterL.style.width = '0%';
  meterR.style.width = '0%';
  dbL.textContent = '-∞';
  dbR.textContent = '-∞';
  startBtn.textContent = 'Start Capture';
  startBtn.classList.remove('stop');
}

function channelPeak(analyser, buf){
  analyser.getByteTimeDomainData(buf);
  let peak = 0;
  for(let i=0;i<buf.length;i++){
    const v = Math.abs(buf[i]-128)/128;
    if(v > peak) peak = v;
  }
  return peak;
}

function startMeter(){
  try{
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint:'interactive' });
    const source = audioCtx.createMediaStreamSource(stream);

    // Split into true independent channels instead of faking one from the other.
    const splitter = audioCtx.createChannelSplitter(2);
    source.connect(splitter);

    analyserL = audioCtx.createAnalyser();
    analyserL.fftSize = 512;
    analyserL.smoothingTimeConstant = 0.75;

    analyserR = audioCtx.createAnalyser();
    analyserR.fftSize = 512;
    analyserR.smoothingTimeConstant = 0.75;

    splitter.connect(analyserL, 0);
    // Mono sources only expose channel 0 — fall back gracefully instead of showing noise.
    const channelCount = source.channelCount || 1;
    if(channelCount > 1){
      splitter.connect(analyserR, 1);
    }

    const bufL = new Uint8Array(analyserL.frequencyBinCount);
    const bufR = new Uint8Array(analyserR.frequencyBinCount);

    function toDb(peak){
      return peak > 0 ? (20*Math.log10(peak)).toFixed(1) + ' dB' : '-∞';
    }

    function meterLoop(){
      if(!loopsRunning) return;

      const peakL = channelPeak(analyserL, bufL);
      const peakR = channelCount > 1 ? channelPeak(analyserR, bufR) : peakL;

      meterL.style.width = Math.min(100, peakL * 130) + '%';
      meterR.style.width = Math.min(100, peakR * 130) + '%';
      dbL.textContent = toDb(peakL);
      dbR.textContent = toDb(peakR);

      requestAnimationFrame(meterLoop);
    }
    meterLoop();
  } catch(e){
    console.error('Meter init failed', e);
  }
}

function startStatsLoop(){
  const track = stream.getVideoTracks()[0];
  if(!track) return;

  function readSettings(){
    const settings = track.getSettings ? track.getSettings() : {};
    if(settings.width && settings.height){
      hudRes.textContent = settings.width + '×' + settings.height;
    }
    return settings;
  }

  if('requestVideoFrameCallback' in video){
    // Single loop, driven by actual delivered frames — measures real
    // cadence instead of just echoing the negotiated capability, and
    // avoids running a separate always-on requestAnimationFrame chain.
    let frameTimes = [];
    let lastPaint = 0;

    function onFrame(now, metadata){
      if(!loopsRunning) return;

      frameTimes.push(metadata.presentationTime ?? now);
      if(frameTimes.length > 30) frameTimes.shift();

      if(now - lastPaint > 500){
        lastPaint = now;
        readSettings();
        if(frameTimes.length > 1){
          const span = frameTimes[frameTimes.length-1] - frameTimes[0];
          const measuredFps = span > 0 ? (frameTimes.length-1) / (span/1000) : 0;
          hudFps.textContent = Math.round(measuredFps) + ' fps';
        }
      }

      video.requestVideoFrameCallback(onFrame);
    }
    video.requestVideoFrameCallback(onFrame);
  } else {
    // Fallback for browsers without requestVideoFrameCallback — a plain
    // interval is plenty for a value that changes rarely, no need for a
    // per-frame loop just to poll it.
    const intervalId = setInterval(() => {
      if(!loopsRunning){ clearInterval(intervalId); return; }
      const settings = readSettings();
      if(settings.frameRate){
        hudFps.textContent = Math.round(settings.frameRate) + ' fps';
      }
    }, 500);
  }
}

async function startCapture(){
  stopStream();
  setStatus('Requesting device access…');

  const videoID = videoSel.value;
  const audioID = audioSel.value;

  if(!videoID){
    if(videoSel.options.length === 0){
      setStatus(
        isFileProtocol()
          ? 'No devices listed — camera access is blocked on file://. Host this page (e.g. GitHub Pages) and open it over http(s):// instead.'
          : 'No video devices found. Click refresh, or check the browser has camera permission for this site.',
        'err'
      );
    } else if(devicesNeedPermission){
      // An option is selected in the UI, but its deviceId is "" because
      // permission was never actually granted — this is not a missing
      // selection, it's a missing permission.
      setStatus('Camera permission isn\'t granted, so the selected device has no usable ID. Allow camera access in the browser\'s site settings, then click refresh.', 'err');
    } else {
      setStatus('Select a video device first.', 'err');
    }
    return;
  }

  localStorage.setItem('capture.videoId', videoID);
  if(audioID) localStorage.setItem('capture.audioId', audioID);

  const res = parseResolution(resSel.value);

  const videoConstraints = {
    deviceId:{ exact:videoID }
  };
  if(res){
    // Exact match avoids the browser/device silently negotiating a different
    // mode and scaling/converting to it internally — that conversion step is
    // a common source of extra buffered frames on USB capture hardware.
    videoConstraints.width = { exact:res.width };
    videoConstraints.height = { exact:res.height };
    videoConstraints.frameRate = { exact:res.frameRate };
  } else {
    videoConstraints.frameRate = { ideal:60 };
  }

  async function acquire(constraints){
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  const audioConstraints = audioID ? {
    deviceId:{ exact:audioID },
    echoCancellation:false,
    noiseSuppression:false,
    autoGainControl:false,
    sampleRate:48000,
    channelCount:2,
    latency:{ ideal:0 }
  } : (audioSel.options.length > 0 ? {
    // Camera and microphone/line-in permission are granted separately by
    // the browser. If video permission was granted but audio permission
    // wasn't, audioSel's options exist but their deviceId is "" — audioID
    // is falsy even though an audio input is physically available. Request
    // generic audio so the browser can prompt for/attach a real device,
    // rather than silently skipping audio entirely.
    echoCancellation:false,
    noiseSuppression:false,
    autoGainControl:false,
    sampleRate:48000,
    channelCount:2,
    latency:{ ideal:0 }
  } : null);

  let audioFailReason = '';

  try{
    // Video and audio are requested TOGETHER, in one call, as the primary
    // path. This matters for composite HDMI/USB capture devices, where the
    // video and audio interfaces belong to one physical device and the
    // driver only permits a single open session — requesting them as two
    // separate getUserMedia calls (a prior attempt at this) silently fails
    // to open the audio side because the device is already in use by the
    // video-only call. A combined request opens both interfaces at once,
    // which is what these devices actually support.
    try{
      stream = await acquire({ video:videoConstraints, audio:audioConstraints || false });
    } catch(exactErr){
      // The exact mode isn't supported by this device — fall back to a
      // relaxed request rather than failing outright. Still faster than
      // the original loose defaults since we try the tight mode first.
      if(exactErr.name === 'OverconstrainedError' && res){
        setStatus('Exact ' + res.width + '×' + res.height + '@' + res.frameRate + ' unsupported — falling back…', 'err');
        const relaxed = {
          deviceId:{ exact:videoID },
          width:{ ideal:res.width },
          height:{ ideal:res.height },
          frameRate:{ ideal:res.frameRate }
        };
        try{
          stream = await acquire({ video:relaxed, audio:audioConstraints || false });
        } catch(relaxedErr){
          // Even the relaxed combined attempt failed — try video alone so a
          // bad/busy audio device doesn't take video down with it too.
          stream = await acquire({ video:relaxed, audio:false });
          audioFailReason = relaxedErr.name === 'NotAllowedError' ? 'microphone permission denied' : relaxedErr.message;
        }
      } else if(audioConstraints){
        // Combined request failed and audio was part of it — retry with
        // video alone before giving up entirely. If this also fails, the
        // problem is genuinely on the video side, so surface the original
        // error instead of this one.
        try{
          stream = await acquire({ video:videoConstraints, audio:false });
          audioFailReason = exactErr.name === 'NotAllowedError'
            ? 'microphone permission denied'
            : (exactErr.name === 'NotFoundError' ? 'no audio device found' : exactErr.message);
        } catch(videoOnlyErr){
          throw exactErr;
        }
      } else {
        throw exactErr;
      }
    }

    const gotAudio = stream.getAudioTracks().length > 0;
    if(gotAudio && !audioID){
      // Audio came through via the generic (no-deviceId) fallback path —
      // re-list devices now that permission is granted so the dropdown
      // shows the real mic/audio input with a real deviceId next time.
      listDevices();
    }

    video.srcObject = stream;
    video.muted = false;
    video.volume = 1.0;
    await video.play();

    overlay.style.opacity = '0';
    tally.classList.add('live');
    tallyLabel.textContent = 'LIVE';
    startBtn.textContent = 'Stop Capture';
    startBtn.classList.add('stop');

    const vTrack = stream.getVideoTracks()[0];
    roDevice.textContent = vTrack.label || 'Capture device';

    // Hints the browser's internal pipeline to favor frame timing over
    // quality smoothing — the same signal used for real-time video calls.
    if('contentHint' in vTrack) vTrack.contentHint = 'motion';

    loopsRunning = true;
    startStatsLoop();

    if(gotAudio){
      startMeter();
    }

    setStatus(
      gotAudio
        ? 'Capture running — direct passthrough, no re-encode.'
        : ('Capture running — video only' + (audioFailReason ? ' (' + audioFailReason + ')' : ', no microphone selected') + '.'),
      gotAudio ? 'ok' : 'err'
    );

    vTrack.addEventListener('ended', () => {
      setStatus('Signal lost — device disconnected.', 'err');
      stopStream();
    });

  } catch(e){
    console.error(e);
    setStatus('Capture failed: ' + e.message, 'err');
    stopStream();
  }
}

startBtn.addEventListener('click', () => {
  if(stream){
    stopStream();
    setStatus('Capture stopped.');
  } else {
    startCapture();
  }
});

refreshBtn.addEventListener('click', listDevices);

shutdownBtn.addEventListener('click', () => {
  const confirmed = window.confirm(
    'This stops capture, releases the camera and microphone, and clears ' +
    'saved device preferences. Continue?'
  );
  if(!confirmed) return;

  stopStream();
  localStorage.removeItem('capture.videoId');
  localStorage.removeItem('capture.audioId');
  videoSel.selectedIndex = 0;
  audioSel.selectedIndex = 0;
  setStatus('Camera and microphone released. Select a device to start again.');
});

fsBtn.addEventListener('click', () => {
  if(!document.fullscreenElement){
    viewportWrap.requestFullscreen().catch(()=>{});
  } else {
    document.exitFullscreen();
  }
});

function isFileProtocol(){
  return location.protocol === 'file:';
}

async function init(){
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    // Chrome treats each file:// page as a unique, non-persistable origin,
    // so camera/mic permissions can't be granted here even though file://
    // is nominally a "secure context" on paper. This is a browser policy
    // limitation, not something fixable from page code.
    if(isFileProtocol()){
      setStatus('Camera access is blocked when opening this file directly (file://). Host it — e.g. GitHub Pages, or any local dev server — and open it over http(s):// instead.', 'err');
    } else {
      setStatus('This browser does not expose camera/microphone access on this page (insecure context).', 'err');
    }
    overlay.querySelector('span').textContent = 'Camera unavailable on file://';
    return;
  }

  // Probed separately — same reasoning as in startCapture(): a combined
  // {video:true, audio:true} request fails entirely if only the mic is
  // denied, which would misreport a working camera as broken.
  let videoOk = false, audioOk = false, videoErr = null, audioErr = null;

  try{
    const p = await navigator.mediaDevices.getUserMedia({ video:true, audio:false });
    p.getTracks().forEach(t => t.stop());
    videoOk = true;
  } catch(e){ videoErr = e; }

  try{
    const p = await navigator.mediaDevices.getUserMedia({ video:false, audio:true });
    p.getTracks().forEach(t => t.stop());
    audioOk = true;
  } catch(e){ audioErr = e; }

  if(!videoOk){
    const e = videoErr;
    if(e.name === 'NotAllowedError'){
      setStatus('Camera permission was denied. Allow access in the browser\'s address-bar site settings and reload.', 'err');
    } else if(e.name === 'NotFoundError'){
      setStatus('No camera was found on this system.', 'err');
    } else if(isFileProtocol()){
      setStatus('Camera access failed (' + e.message + '). This is commonly blocked on file:// — host the page (e.g. GitHub Pages) and open it over http(s):// instead.', 'err');
    } else {
      setStatus('Permission needed: allow camera access to see device names.', 'err');
    }
  } else if(!audioOk){
    setStatus('Camera ready. Microphone permission was denied or unavailable — video-only capture will still work.', 'err');
  }
  await listDevices();
}

if(navigator.mediaDevices){
  navigator.mediaDevices.addEventListener('devicechange', listDevices);
}

init();
