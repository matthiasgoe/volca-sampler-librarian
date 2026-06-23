import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  getAudioBufferForAudioFileData,
  getSourceAudioBuffer,
  useAudioPlaybackContext,
} from './utils/audioData.js';
import { getSyroSampleBuffer, useSyroTransfer } from './utils/syro.js';
import { storeAudioSourceFile, SampleContainer } from './store.js';
import { newSampleName } from './utils/words.js';

import './SimpleApp.css';

const SLOT_COUNT = 100; // KORG volca sample addresses slots 0–99
const SLOTS_LS_KEY = 'volca-sampler-slot-assignments';

/** @param {number} seconds */
function formatDuration(seconds) {
  if (!isFinite(seconds) || seconds == null) return '';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function readSavedSlots() {
  try {
    const raw = window.localStorage.getItem(SLOTS_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    return {};
  }
}

/**
 * Simplified Volca Sampler interface.
 */
export default function SimpleApp() {
  /** @type {[Map<string, SampleContainer>, Function]} */
  const [samples, setSamples] = useState(new Map());
  /** @type {[Map<string, number>, Function]} */
  const [durations, setDurations] = useState(new Map());
  // slotNumber -> sampleId (a sample id may appear under several slots)
  /** @type {[Map<number, string>, Function]} */
  const [slotAssignments, setSlotAssignments] = useState(new Map());
  /** @type {[Set<number>, Function]} */
  const [selectedSlots, setSelectedSlots] = useState(new Set());
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  /** @type {[string[], Function]} */
  const [importErrors, setImportErrors] = useState([]);
  /** @type {[string | null, Function]} */
  const [playingId, setPlayingId] = useState(null);

  const fileInputRef = useRef(null);
  const dragRef = useRef(null);
  const samplesRef = useRef(samples);
  samplesRef.current = samples;
  const slotAssignmentsRef = useRef(slotAssignments);
  slotAssignmentsRef.current = slotAssignments;
  const hasLoadedRef = useRef(false);
  const bufferCacheRef = useRef(new Map()); // id -> AudioBuffer (for preview)
  const stopPreviewRef = useRef(() => {});

  const { playAudioBuffer } = useAudioPlaybackContext();

  // ---- load persisted library on startup -----------------------------------

  useEffect(() => {
    const savedSlots = readSavedSlots(); // read BEFORE the save effect can run
    let cancelled = false;
    (async () => {
      try {
        const { sampleMetadata } =
          await SampleContainer.getAllMetadataFromStore();
        if (cancelled) return;
        /** @type {Map<string, SampleContainer>} */
        const map = new Map();
        for (const [id, metadata] of sampleMetadata) {
          map.set(id, new SampleContainer.Mutable({ id, ...metadata }));
        }
        setSamples(map);
        // restore slot assignments, keeping only ids that still exist
        const restored = new Map();
        for (const [slotStr, id] of Object.entries(savedSlots)) {
          const slot = Number(slotStr);
          if (map.has(id) && slot >= 0 && slot < SLOT_COUNT) {
            restored.set(slot, id);
          }
        }
        setSlotAssignments(restored);
        setSelectedSlots(new Set(restored.keys()));
        hasLoadedRef.current = true;
        setLoading(false);
        // fill durations + warm the preview cache in the background
        for (const [id, container] of map) {
          if (cancelled) break;
          try {
            const buf = await getSourceAudioBuffer(
              container.metadata.sourceFileId,
              Boolean(container.metadata.userFileInfo)
            );
            if (cancelled) break;
            bufferCacheRef.current.set(id, buf);
            setDurations((prev) => new Map(prev).set(id, buf.duration));
          } catch (err) {
            /* ignore individual decode errors */
          }
        }
      } catch (err) {
        console.error(err);
        hasLoadedRef.current = true;
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      stopPreviewRef.current();
    };
  }, []);

  // ---- persist slot assignments --------------------------------------------

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    try {
      /** @type {Record<string, string>} */
      const obj = {};
      for (const [slot, id] of slotAssignments) obj[slot] = id;
      window.localStorage.setItem(SLOTS_LS_KEY, JSON.stringify(obj));
    } catch (err) {
      /* ignore */
    }
  }, [slotAssignments]);

  // ---- derived -------------------------------------------------------------

  const allSamples = useMemo(() => [...samples.values()], [samples]);

  const slotsBySample = useMemo(() => {
    /** @type {Map<string, number[]>} */
    const m = new Map();
    for (const [slot, id] of slotAssignments) {
      const arr = m.get(id) || [];
      arr.push(slot);
      m.set(id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a - b);
    return m;
  }, [slotAssignments]);

  const filledSlots = useMemo(
    () => [...slotAssignments.keys()].sort((a, b) => a - b),
    [slotAssignments]
  );

  const transferContainers = useMemo(() => {
    const slots = [...selectedSlots].sort((a, b) => a - b);
    /** @type {SampleContainer[]} */
    const list = [];
    for (const slot of slots) {
      const id = slotAssignments.get(slot);
      const sample = id && samples.get(id);
      if (sample) {
        list.push(new SampleContainer({ ...sample.metadata, slotNumber: slot }));
      }
    }
    return list;
  }, [selectedSlots, slotAssignments, samples]);

  const selectedKey = useMemo(
    () =>
      [...selectedSlots]
        .sort((a, b) => a - b)
        .map((slot) => `${slot}:${slotAssignments.get(slot)}`)
        .join(','),
    [selectedSlots, slotAssignments]
  );
  const transferRef = useRef(transferContainers);
  transferRef.current = transferContainers;

  // ---- preview playback ----------------------------------------------------

  const getBufferFor = useCallback(async (id) => {
    if (bufferCacheRef.current.has(id)) return bufferCacheRef.current.get(id);
    const container = samplesRef.current.get(id);
    if (!container) return null;
    const buf = await getSourceAudioBuffer(
      container.metadata.sourceFileId,
      Boolean(container.metadata.userFileInfo)
    );
    bufferCacheRef.current.set(id, buf);
    return buf;
  }, []);

  const togglePreview = useCallback(
    async (id) => {
      // clicking the sample that's already playing stops it
      if (playingId === id) {
        stopPreviewRef.current();
        return;
      }
      try {
        const buf = await getBufferFor(id);
        if (!buf) return;
        const stop = playAudioBuffer(buf, {
          onEnded: () => setPlayingId(null),
        });
        stopPreviewRef.current = stop;
        setPlayingId(id);
      } catch (err) {
        console.error(err);
      }
    },
    [playingId, getBufferFor, playAudioBuffer]
  );

  // ---- importing -----------------------------------------------------------

  const importFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setImporting(true);
    /** @type {string[]} */
    const errors = [];
    /** @type {Array<{ container: SampleContainer, duration: number, buffer: AudioBuffer }>} */
    const created = [];
    for (const file of files) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const audioFileBuffer = new Uint8Array(arrayBuffer);
        const audioBuffer = await getAudioBufferForAudioFileData(
          audioFileBuffer
        );
        const sourceFileId = await storeAudioSourceFile(audioFileBuffer);
        const lastDot = file.name.lastIndexOf('.');
        const name =
          lastDot > 0
            ? file.name.slice(0, lastDot)
            : file.name || newSampleName();
        const ext = lastDot > 0 ? file.name.slice(lastDot) : '';
        const container = new SampleContainer.Mutable({
          name,
          sourceFileId,
          trim: { frames: [0, 0] },
          userFileInfo: { type: file.type, ext },
        });
        await container.persist();
        created.push({ container, duration: audioBuffer.duration, buffer: audioBuffer });
      } catch (err) {
        console.error(err);
        errors.push(`${file.name} (unsupported or unreadable)`);
      }
    }
    if (created.length) {
      setSamples((prev) => {
        const next = new Map(prev);
        for (const { container } of created) next.set(container.id, container);
        return next;
      });
      setDurations((prev) => {
        const next = new Map(prev);
        for (const { container, duration } of created)
          next.set(container.id, duration);
        return next;
      });
      for (const { container, buffer } of created) {
        bufferCacheRef.current.set(container.id, buffer);
      }
    }
    setImportErrors(errors);
    setImporting(false);
  }, []);

  const onFileInputChange = useCallback(
    (e) => {
      importFiles(e.target.files);
      e.target.value = '';
    },
    [importFiles]
  );

  // ---- assignment ----------------------------------------------------------

  const assignToSlot = useCallback((sampleId, slot) => {
    const next = new Map(slotAssignmentsRef.current);
    next.set(slot, sampleId);
    setSlotAssignments(next);
    setSelectedSlots((prev) => new Set(prev).add(slot));
  }, []);

  const moveSlot = useCallback((fromSlot, toSlot) => {
    if (fromSlot === toSlot) return;
    const id = slotAssignmentsRef.current.get(fromSlot);
    if (id === undefined) return;
    const next = new Map(slotAssignmentsRef.current);
    next.delete(fromSlot);
    next.set(toSlot, id);
    setSlotAssignments(next);
    setSelectedSlots((prev) => {
      const s = new Set(prev);
      s.delete(fromSlot);
      s.add(toSlot);
      return s;
    });
  }, []);

  const clearSlot = useCallback((slot) => {
    const next = new Map(slotAssignmentsRef.current);
    if (!next.has(slot)) return;
    next.delete(slot);
    setSlotAssignments(next);
    setSelectedSlots((prev) => {
      const s = new Set(prev);
      s.delete(slot);
      return s;
    });
  }, []);

  const removeSample = useCallback(
    (sampleId) => {
      if (playingId === sampleId) stopPreviewRef.current();
      const next = new Map();
      const clearedSlots = [];
      for (const [slot, id] of slotAssignmentsRef.current) {
        if (id === sampleId) clearedSlots.push(slot);
        else next.set(slot, id);
      }
      setSlotAssignments(next);
      if (clearedSlots.length) {
        setSelectedSlots((prev) => {
          const s = new Set(prev);
          for (const slot of clearedSlots) s.delete(slot);
          return s;
        });
      }
      const sample = samplesRef.current.get(sampleId);
      const nextSamples = new Map(samplesRef.current);
      nextSamples.delete(sampleId);
      setSamples(nextSamples);
      bufferCacheRef.current.delete(sampleId);
      if (sample && sample instanceof SampleContainer.Mutable) {
        sample.remove().catch(() => {});
      }
    },
    [playingId]
  );

  // ---- drag and drop -------------------------------------------------------

  const onDragStartLib = useCallback((e, sampleId) => {
    dragRef.current = { kind: 'lib', id: sampleId };
    try {
      e.dataTransfer.setData('text/plain', sampleId);
      e.dataTransfer.effectAllowed = 'copyMove';
    } catch (err) {}
  }, []);

  const onDragStartSlot = useCallback((e, slot, sampleId) => {
    dragRef.current = { kind: 'slot', slot, id: sampleId };
    try {
      e.dataTransfer.setData('text/plain', sampleId);
      e.dataTransfer.effectAllowed = 'move';
    } catch (err) {}
  }, []);

  const onDropToSlot = useCallback(
    (e, slot) => {
      e.preventDefault();
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      if (drag.kind === 'lib') assignToSlot(drag.id, slot);
      else if (drag.kind === 'slot') moveSlot(drag.slot, slot);
    },
    [assignToSlot, moveSlot]
  );

  const onDropToLibrary = useCallback(
    (e) => {
      e.preventDefault();
      const drag = dragRef.current;
      dragRef.current = null;
      if (drag && drag.kind === 'slot') clearSlot(drag.slot);
    },
    [clearSlot]
  );

  const allowDrop = useCallback((e) => e.preventDefault(), []);

  // ---- transfer ------------------------------------------------------------

  const [syroProgress, setSyroProgress] = useState(1);
  const [{ syroBuffer, dataStartPoints }, setSyroBufferAndDataStartPoints] =
    useState({
      syroBuffer: /** @type {Uint8Array | Error | null} */ (null),
      dataStartPoints: /** @type {number[]} */ ([]),
    });

  const {
    startTransfer,
    stopTransfer,
    transferInProgress,
    transferProgress,
    currentlyTransferringItem,
  } = useSyroTransfer({
    syroBuffer,
    dataStartPoints,
    selectedItems: transferContainers,
  });

  useEffect(() => {
    const list = transferRef.current;
    if (!list.length || list.length > 110) {
      setSyroBufferAndDataStartPoints({ syroBuffer: null, dataStartPoints: [] });
      return;
    }
    let cancelled = false;
    setSyroProgress(0);
    setSyroBufferAndDataStartPoints({ syroBuffer: null, dataStartPoints: [] });
    let stop = () => {
      cancelled = true;
    };
    try {
      const { syroBufferPromise, cancelWork } = getSyroSampleBuffer(
        list,
        (progress) => {
          if (!cancelled) setSyroProgress(progress);
        }
      );
      stop = () => {
        cancelWork();
        cancelled = true;
      };
      syroBufferPromise.then(({ syroBuffer, dataStartPoints }) => {
        if (cancelled) return;
        setSyroBufferAndDataStartPoints({ syroBuffer, dataStartPoints });
      });
    } catch (err) {
      console.error(err);
      setSyroBufferAndDataStartPoints({
        syroBuffer: new Error(String(err)),
        dataStartPoints: [],
      });
    }
    return () => stop();
  }, [selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const syroReady = syroBuffer instanceof Uint8Array;
  const syroBuildError = syroBuffer instanceof Error;
  const activeSlot =
    transferInProgress && currentlyTransferringItem
      ? currentlyTransferringItem.metadata.slotNumber
      : null;

  // ---- selection controls --------------------------------------------------

  const toggleSlotSelected = useCallback((slot) => {
    setSelectedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot);
      else next.add(slot);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedSlots(new Set(slotAssignmentsRef.current.keys()));
  }, []);
  const selectNone = useCallback(() => setSelectedSlots(new Set()), []);

  // ---- render --------------------------------------------------------------

  const ledValue = transferInProgress
    ? `${Math.round(transferProgress * 100)}`
    : `${transferContainers.length}`;

  return (
    <div className="simple-app">
      <header className="simple-header">
        <div className="brand">
          <span className="brand-name">Volca Sampler Librarian</span>
        </div>
        <div className="led" title="selected slots / transfer progress">
          <span className="led-digits">{ledValue.padStart(3, ' ')}</span>
          <span className="led-label">
            {transferInProgress ? '%' : 'SEL'}
          </span>
        </div>
      </header>

      <p className="hint">
        Import audio, preview with ▶, drag onto a slot (it stays in your
        library), then transfer. Connect your volca sample’s audio input to your
        computer’s headphone output and turn the volume up first.
      </p>

      <div className="simple-body">
        {/* ---------- left: library ---------- */}
        <section
          className="tray"
          onDragOver={allowDrop}
          onDrop={onDropToLibrary}
        >
          <div className="tray-head">
            <h2>Library</h2>
            <button
              className="btn btn-primary"
              onClick={() =>
                fileInputRef.current && fileInputRef.current.click()
              }
              disabled={importing}
            >
              {importing ? 'Importing…' : 'Import files'}
            </button>
            <input
              ref={fileInputRef}
              hidden
              multiple
              type="file"
              accept="audio/*,video/*,.wav,.mp3,.ogg,.aif,.aiff,.flac,.m4a"
              onChange={onFileInputChange}
            />
          </div>

          {importErrors.length > 0 && (
            <div className="errors">Skipped: {importErrors.join(', ')}</div>
          )}

          {loading && <div className="empty">Loading your library…</div>}

          {!loading && allSamples.length === 0 && !importing && (
            <div className="empty">
              No samples yet. Click <strong>Import files</strong> to add several
              at once.
            </div>
          )}

          <ul className="sample-list">
            {allSamples.map((s) => {
              const slots = slotsBySample.get(s.id) || [];
              const isPlaying = playingId === s.id;
              return (
                <li
                  key={s.id}
                  className="sample-chip"
                  draggable
                  onDragStart={(e) => onDragStartLib(e, s.id)}
                >
                  <button
                    className={`play-btn ${isPlaying ? 'playing' : ''}`}
                    title={isPlaying ? 'Stop' : 'Preview'}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePreview(s.id);
                    }}
                  >
                    {isPlaying ? '■' : '▶'}
                  </button>
                  <span className="chip-name" title={s.metadata.name}>
                    {s.metadata.name}
                  </span>
                  {slots.length > 0 && (
                    <span
                      className="chip-slots"
                      title={`In slot${slots.length > 1 ? 's' : ''} ${slots.join(
                        ', '
                      )}`}
                    >
                      {slots.map((n) => `#${n}`).join(' ')}
                    </span>
                  )}
                  <span className="chip-dur">
                    {formatDuration(durations.get(s.id))}
                  </span>
                  <button
                    className="chip-x"
                    title="Remove from library"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSample(s.id);
                    }}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ---------- right: slot grid ---------- */}
        <section className="slots-section">
          <div className="slots-head">
            <h2>Slots</h2>
            <div className="slots-tools">
              <span className="muted">{filledSlots.length} filled</span>
              <button className="btn btn-ghost" onClick={selectAll}>
                Select all
              </button>
              <button className="btn btn-ghost" onClick={selectNone}>
                Select none
              </button>
            </div>
          </div>

          <div className="slot-grid">
            {Array.from({ length: SLOT_COUNT }, (_, slot) => {
              const id = slotAssignments.get(slot);
              const sample = id ? samples.get(id) : null;
              const selected = selectedSlots.has(slot);
              const isActive = activeSlot === slot;
              const isPlaying = sample && playingId === sample.id;
              return (
                <div
                  key={slot}
                  className={[
                    'slot',
                    sample ? 'slot-filled' : 'slot-empty',
                    sample && selected ? 'slot-selected' : '',
                    isActive ? 'slot-active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onDragOver={allowDrop}
                  onDrop={(e) => onDropToSlot(e, slot)}
                  onClick={() => sample && toggleSlotSelected(slot)}
                >
                  <span className="slot-num">{slot}</span>
                  {sample ? (
                    <>
                      <span
                        className="slot-sample"
                        draggable
                        onDragStart={(e) =>
                          onDragStartSlot(e, slot, sample.id)
                        }
                        title={sample.metadata.name}
                      >
                        {sample.metadata.name}
                      </span>
                      <div className="slot-actions">
                        <button
                          className={`slot-play ${isPlaying ? 'playing' : ''}`}
                          title={isPlaying ? 'Stop' : 'Preview'}
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePreview(sample.id);
                          }}
                        >
                          {isPlaying ? '■' : '▶'}
                        </button>
                        <button
                          className="slot-x"
                          title="Clear slot"
                          onClick={(e) => {
                            e.stopPropagation();
                            clearSlot(slot);
                          }}
                        >
                          ×
                        </button>
                      </div>
                    </>
                  ) : (
                    <span className="slot-placeholder">empty</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* ---------- transfer bar ---------- */}
      <footer className="transfer-bar">
        {syroBuildError ? (
          <span className="error-text">
            Couldn’t prepare the audio. Try reloading.
          </span>
        ) : transferInProgress ? (
          <>
            <div className="progress">
              <div
                className="progress-fill"
                style={{ width: `${Math.round(transferProgress * 100)}%` }}
              />
            </div>
            <span className="muted">
              Sending{' '}
              {currentlyTransferringItem
                ? currentlyTransferringItem.metadata.name
                : ''}
              …
            </span>
            <button className="btn btn-danger" onClick={stopTransfer}>
              Stop
            </button>
          </>
        ) : (
          <>
            <span className="muted">
              {transferContainers.length
                ? `${transferContainers.length} slot${
                    transferContainers.length === 1 ? '' : 's'
                  } selected`
                : 'Drag samples onto slots, then select them'}
            </span>
            {transferContainers.length > 0 && !syroReady && (
              <span className="muted">
                preparing… {Math.round(syroProgress * 100)}%
              </span>
            )}
            <button
              className="btn btn-primary btn-transfer"
              onClick={startTransfer}
              disabled={!transferContainers.length}
            >
              {transferContainers.length > 1 ? 'Transfer selected' : 'Transfer'}
            </button>
          </>
        )}
      </footer>

      <div className="credit-bar">
        Volca Sampler is an app created by{' '}
        <a href="https://benwiley.org/" target="_blank" rel="noopener noreferrer">
          Ben Wiley
        </a>{' '}
        (
        <a
          href="https://github.com/benwiley4000/volca-sampler"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        ). “volca sample” is a trademark of KORG Inc., who is not affiliated with
        this app.
      </div>
    </div>
  );
}
