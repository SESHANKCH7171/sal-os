"use client";

import { useState, useRef, useEffect } from "react";
import { Mic, Square, Loader2, AlertCircle } from "lucide-react";

export interface QuickLeadExtracted {
  full_name: string;
  first_name: string;
  title: string | null;
  company: string | null;
  industry: string | null;
  linkedin_url: string | null;
  email: string | null;
  city: string | null;
  location_region: "KSA" | "UAE" | "UK" | "US" | "OTHER";
  notes: string | null;
}

interface VoiceRecorderButtonProps {
  mode?: "content_idea" | "image_tweak" | "quick_lead";
  onTranscribed: (result: { transcript: string; leadData?: QuickLeadExtracted | null }) => void;
  className?: string;
  label?: string;
}

export default function VoiceRecorderButton({
  mode = "content_idea",
  onTranscribed,
  className = "",
  label,
}: VoiceRecorderButtonProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = async () => {
    setErrorMessage(null);
    audioChunksRef.current = [];

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Audio recording is not supported on this browser.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Detect MIME type with Safari/iOS mp4 fallback
      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        if (MediaRecorder.isTypeSupported("audio/webm")) {
          mimeType = "audio/webm";
        } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
          mimeType = "audio/mp4";
        } else {
          mimeType = ""; // Browser default
        }
      }

      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop audio tracks
        stream.getTracks().forEach((track) => track.stop());

        const finalMime = mediaRecorder.mimeType || "audio/webm";
        const extension = finalMime.includes("mp4") ? "mp4" : "webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: finalMime });

        if (audioBlob.size === 0) {
          setErrorMessage("No audio recorded.");
          return;
        }

        await uploadAudio(audioBlob, `speech.${extension}`);
      };

      mediaRecorder.start(250); // Slice into chunks every 250ms
      setIsRecording(true);
      setRecordSeconds(0);

      timerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch (err: any) {
      console.error("Microphone access error:", err);
      setErrorMessage(err.message || "Failed to access microphone");
    }
  };

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const uploadAudio = async (blob: Blob, filename: string) => {
    setIsTranscribing(true);
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", blob, filename);
      formData.append("mode", mode);

      const res = await fetch("/api/voice/transcribe", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Transcription failed with code ${res.status}`);
      }

      const data = await res.json();
      if (data.transcript) {
        onTranscribed({ transcript: data.transcript, leadData: data.leadData });
      } else {
        setErrorMessage("Whisper returned an empty transcript.");
      }
    } catch (err: any) {
      console.error("Audio transcription error:", err);
      setErrorMessage(err.message || "Failed to transcribe speech");
    } finally {
      setIsTranscribing(false);
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <div className="inline-flex items-center gap-2">
        {!isRecording ? (
          <button
            type="button"
            onClick={startRecording}
            disabled={isTranscribing}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-[#232838] bg-[#121520] hover:bg-indigo-600/10 hover:border-indigo-500/40 text-xs text-slate-300 hover:text-white transition shadow-sm disabled:opacity-50 ${className}`}
            title="Record speech with Groq Whisper"
          >
            {isTranscribing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
            ) : (
              <Mic className="w-3.5 h-3.5 text-indigo-400" />
            )}
            <span>
              {isTranscribing
                ? "Transcribing with Whisper..."
                : label || (mode === "quick_lead" ? "Voice Lead Capture" : "Speak Idea")}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={stopRecording}
            className="flex items-center space-x-2 px-3.5 py-1.5 rounded-lg border border-red-500/50 bg-red-950/40 text-xs text-red-200 animate-pulse font-mono shadow-sm shadow-red-500/20"
          >
            <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
            <Square className="w-3.5 h-3.5 fill-red-400 text-red-400" />
            <span>Recording ({formatTimer(recordSeconds)}) — Click to Finish</span>
          </button>
        )}
      </div>

      {errorMessage && (
        <span className="text-[11px] text-red-400 flex items-center gap-1 font-mono">
          <AlertCircle className="w-3 h-3" />
          {errorMessage}
        </span>
      )}
    </div>
  );
}
