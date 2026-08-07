const statusEl = document.getElementById('status')
const buttonEl = document.getElementById('record')
const transcriptEl = document.getElementById('transcript')

let sessionId = null
let eventSource = null
let mediaRecorder = null
let recordedChunks = []
let mode = 'idle' // idle | listening-to-interviewer | recording | ended

function setStatus(text) {
  statusEl.textContent = text
}

// Renders only Entry-shaped data delivered over SSE — never a debug field,
// never `lastRaw()`. This is the client half of the spoiler gate: even if a
// route ever leaked something extra, this renderer has no code path that
// would display it, because it only reads `speaker`/`text`/`at`.
function appendEntry(entry) {
  const li = document.createElement('li')
  li.textContent = `${entry.speaker === 'andre' ? 'You' : 'Interviewer'}: ${entry.text}`
  transcriptEl.appendChild(li)
}

function speak(text) {
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.onend = resolve
    utterance.onerror = resolve
    window.speechSynthesis.speak(utterance)
  })
}

async function connectStream(id) {
  eventSource = new EventSource(`/api/session/${id}/stream`)

  eventSource.addEventListener('sentence', async (event) => {
    const { text } = JSON.parse(event.data)
    setStatus('Interviewer speaking…')
    await speak(text)
  })

  eventSource.addEventListener('entry', (event) => {
    appendEntry(JSON.parse(event.data))
  })

  eventSource.addEventListener('ended', (event) => {
    const { endedEarly } = JSON.parse(event.data)
    setStatus(endedEarly ? `Session ended early: ${endedEarly}` : 'Session ended.')
    eventSource.close()
    buttonEl.textContent = 'Start session'
    mode = 'ended'
  })
}

async function startSession() {
  const res = await fetch('/api/session', { method: 'POST' })
  if (res.status === 409) {
    setStatus('A session is already in progress.')
    return
  }
  const { id } = await res.json()
  sessionId = id
  transcriptEl.innerHTML = ''
  await connectStream(id)
  mode = 'listening-to-interviewer'
  buttonEl.textContent = 'Record your answer'
}

async function startRecording() {
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (error) {
    setStatus(`Microphone access failed: ${error.message || error}. Click to try again.`)
    return
  }
  recordedChunks = []
  mediaRecorder = new MediaRecorder(stream)
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data)
  }
  mediaRecorder.start()
  mode = 'recording'
  buttonEl.textContent = 'Done — send turn'
  setStatus('Recording. Press the button when you are done.')
}

async function stopRecordingAndSubmit() {
  const stopped = new Promise((resolve) => {
    mediaRecorder.onstop = resolve
  })
  mediaRecorder.stop()
  await stopped
  for (const track of mediaRecorder.stream.getTracks()) track.stop()

  const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType })
  setStatus('Transcribing…')
  const res = await fetch(`/api/session/${sessionId}/turn`, {
    method: 'POST',
    headers: { 'content-type': blob.type || 'application/octet-stream' },
    body: blob,
  })
  if (res.status === 422) {
    const { error } = await res.json()
    setStatus(`Turn failed: ${error}`)
    mode = 'ended'
    return
  }
  mode = 'listening-to-interviewer'
  buttonEl.textContent = 'Record your answer'
}

async function endSession() {
  await fetch(`/api/session/${sessionId}/end`, { method: 'POST' })
}

buttonEl.addEventListener('click', async () => {
  if (mode === 'idle' || mode === 'ended') {
    await startSession()
  } else if (mode === 'listening-to-interviewer') {
    await startRecording()
  } else if (mode === 'recording') {
    await stopRecordingAndSubmit()
  }
})

window.addEventListener('beforeunload', () => {
  if (sessionId && mode !== 'ended') {
    // Best-effort — the SSE disconnect handler on the server is the real
    // guarantee that an abandoned tab still gets persisted.
    navigator.sendBeacon(`/api/session/${sessionId}/end`)
  }
})
