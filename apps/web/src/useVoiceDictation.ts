import { useCallback, useEffect, useRef, useState } from 'react';
import { api, transcribeAudio } from './api.ts';

type State = 'idle' | 'permission' | 'recording' | 'transcribing';
type Status = 'loading' | 'ready' | 'preparing' | 'unavailable' | 'disabled';
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
export function useVoiceDictation({
  context,
  enabled,
  onText,
}: {
  context: string;
  enabled: boolean;
  onText: (text: string) => void;
}) {
  const [state, setState] = useState<State>('idle');
  const [status, setStatus] = useState<Status>('loading');
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState('');
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const resources = useRef<{
    generation: number;
    stream?: MediaStream;
    recorder?: MediaRecorder;
    timer?: ReturnType<typeof setInterval>;
    abort?: AbortController;
  }>({ generation: 0 });
  const release = useCallback(() => {
    const current = resources.current;
    clearInterval(current.timer);
    current.stream?.getTracks().forEach((track) => track.stop());
    current.stream = undefined;
  }, []);
  const cancel = useCallback(() => {
    const current = resources.current;
    current.generation++;
    current.abort?.abort();
    const recorder = current.recorder;
    if (recorder?.state === 'recording') recorder.stop();
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
    }
    current.recorder = undefined;
    current.abort = undefined;
    release();
    setState('idle');
    setMessage('');
  }, [release]);
  useEffect(() => {
    cancel();
    const hidden = () => {
      if (document.hidden) cancel();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', cancel);
    return () => {
      cancel();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', cancel);
    };
  }, [context, enabled, cancel]);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      let next: Status = 'unavailable';
      try {
        next = (await api<{ state: Status }>('/voice/status')).state;
      } catch {
        /* Text chat remains available. */
      }
      if (disposed) return;
      setStatus(next);
      timer = setTimeout(() => void check(), next === 'ready' ? 30_000 : 5000);
    };
    void check();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [enabled]);
  const supported =
    window.isSecureContext &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== 'undefined';
  const stop = () => {
    const recorder = resources.current.recorder;
    if (recorder?.state === 'recording') {
      recorder.stop();
      release();
    }
  };
  const start = async () => {
    if (!enabled || !supported || status !== 'ready' || state !== 'idle') return;
    cancel();
    const current = resources.current;
    const generation = current.generation;
    const valid = () => current.generation === generation;
    setState('permission');
    setSeconds(0);
    try {
      const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('Ce navigateur ne propose pas de format audio compatible.');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (!valid()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      current.stream = stream;
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 });
      current.recorder = recorder;
      const chunks: Blob[] = [];
      let bytes = 0;
      recorder.ondataavailable = (event) => {
        if (!valid() || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > 2 * 1024 * 1024) {
          cancel();
          setMessage('La dictée dépasse 2 Mo. Essayez une dictée plus courte.');
          return;
        }
        chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (valid()) {
          cancel();
          setMessage('L’enregistrement a été interrompu. Réessayez.');
        }
      };
      recorder.onstop = async () => {
        if (!valid()) return;
        release();
        setState('transcribing');
        const abort = new AbortController();
        current.abort = abort;
        const timeout = setTimeout(() => abort.abort(), 40_000);
        try {
          const audio = new Blob(chunks, { type: recorder.mimeType || mimeType });
          if (!audio.size) throw new Error('Aucun son enregistré. Réessayez.');
          const result = await transcribeAudio(audio, abort.signal);
          if (!valid()) return;
          if (result.text) {
            onTextRef.current(result.text);
            setMessage('Dictée ajoutée. Vous pouvez la corriger avant d’envoyer.');
          } else setMessage('Aucune parole détectée. Réessayez en parlant près du micro.');
        } catch (error) {
          if (valid())
            setMessage(
              error instanceof Error && error.name !== 'AbortError'
                ? error.message
                : 'La transcription a été interrompue. Réessayez.',
            );
        } finally {
          clearTimeout(timeout);
          chunks.length = 0;
          if (valid()) {
            current.recorder = undefined;
            current.abort = undefined;
            setState('idle');
          }
        }
      };
      recorder.start(250);
      setState('recording');
      const started = Date.now();
      current.timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        // Leave a little margin for delayed MediaRecorder events on mobile.
        if (elapsed >= 59) stop();
      }, 250);
    } catch (error) {
      if (!valid()) return;
      release();
      setState('idle');
      const name = error instanceof Error ? error.name : '';
      setMessage(
        name === 'NotAllowedError'
          ? 'Accès au micro refusé. Autorisez le microphone dans les réglages du navigateur.'
          : name === 'NotFoundError'
            ? 'Aucun microphone détecté.'
            : name === 'NotReadableError'
              ? 'Le microphone est indisponible ou utilisé par une autre application.'
              : error instanceof Error
                ? error.message
                : 'Impossible de démarrer le microphone.',
      );
    }
  };
  const hint = !supported
    ? 'La dictée nécessite HTTPS (ou localhost) et un navigateur compatible.'
    : status === 'preparing' || status === 'loading'
      ? 'Préparation du moteur vocal…'
      : status === 'disabled'
        ? 'La dictée n’est pas configurée sur ce serveur.'
        : status === 'unavailable'
          ? 'Moteur vocal indisponible. Nouvelle vérification automatique.'
          : 'Dicter un message';
  return {
    state,
    seconds,
    message,
    hint,
    available: supported && status === 'ready',
    busy: state !== 'idle',
    start,
    stop,
    cancel,
  };
}
