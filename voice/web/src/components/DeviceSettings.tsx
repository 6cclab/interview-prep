import type { MicDevice, OutputDevice } from '../types'

/**
 * Microphone/speaker selection. Not in the design handoff at all — like
 * `MicCheck.tsx`, this is a subordinate diagnostic-adjacent panel reached
 * from the header, not part of the single-screen layout the handoff
 * specifies (header, transcript, pacing readout, error banner, dock). It
 * reports/changes device selection only and never touches session state.
 */

interface Props {
  inputDevices: MicDevice[]
  selectedInputId: string | null
  onSelectInput(deviceId: string): void
  outputDevices: OutputDevice[]
  selectedOutputId: string | null
  onSelectOutput(id: string): void
}

export function DeviceSettings({
  inputDevices,
  selectedInputId,
  onSelectInput,
  outputDevices,
  selectedOutputId,
  onSelectOutput,
}: Props) {
  return (
    <section className="device-settings" aria-label="Audio device settings">
      <div className="device-settings__row">
        <label htmlFor="device-settings-mic">Microphone</label>
        <select
          id="device-settings-mic"
          value={selectedInputId ?? ''}
          onChange={(event) => onSelectInput(event.target.value)}
        >
          <option value="">System default</option>
          {inputDevices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
        {inputDevices.length === 0 && (
          <p className="device-settings__hint">
            No named microphones yet — grant microphone access (press "Start session") to see them listed here.
          </p>
        )}
      </div>

      <div className="device-settings__row">
        <label htmlFor="device-settings-speaker">Speaker</label>
        <select
          id="device-settings-speaker"
          value={selectedOutputId ?? ''}
          onChange={(event) => onSelectOutput(event.target.value)}
        >
          <option value="">System default</option>
          {outputDevices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </select>
        <p className="device-settings__hint">
          The interviewer is spoken through the server, on this machine — the browser has no way to route audio to a
          chosen speaker on its own.
        </p>
      </div>
    </section>
  )
}
