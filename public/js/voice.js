// Browser speech: recognition for the candidate's answers, synthesis for the interviewer.
// Free and private: both run in the browser (Chrome, Edge and Safari support them).

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const canListen = Boolean(Recognition);
export const canSpeak = 'speechSynthesis' in window;

/**
 * @param {{ onText: (text: string) => void, onState: (listening: boolean, error?: string) => void }} handlers
 */
export function createRecognizer({ onText, onState }) {
  if (!Recognition) return null;
  const rec = new Recognition();
  rec.lang = 'en-US';
  rec.continuous = true;
  rec.interimResults = true;

  let base = '';
  let listening = false;

  rec.onresult = (event) => {
    let heard = '';
    for (let i = 0; i < event.results.length; i += 1) heard += event.results[i][0].transcript;
    onText(`${base} ${heard}`.replace(/\s+/g, ' ').trim());
  };
  rec.onend = () => {
    listening = false;
    onState(false);
  };
  rec.onerror = (event) => {
    listening = false;
    onState(false, event.error);
  };

  return {
    start(existingText = '') {
      base = existingText;
      try {
        rec.start();
        listening = true;
        onState(true);
      } catch {
        // Already started: ignore.
      }
    },
    stop() {
      rec.stop();
    },
    get listening() {
      return listening;
    },
  };
}

function englishVoice() {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === 'en-US' && /natural|samantha|google us/i.test(v.name)) ||
    voices.find((v) => v.lang === 'en-US') ||
    null
  );
}

export function speak(text) {
  if (!canSpeak) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.95;
  const voice = englishVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (canSpeak) window.speechSynthesis.cancel();
}
