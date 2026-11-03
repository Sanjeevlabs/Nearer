"use client";

// The city field fills itself: first a quiet guess from the connection
// (/api/whereami), and, only if the person taps "Use my location", the device's
// location once. Never replaces something they typed. Only a city name comes
// back to the page; coordinates stay in this function.
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { htmlLang } from "./ui-strings/lang";

const Guess = z.object({ city: z.string().optional() });
const Found = z.object({ city: z.string().min(1) });

export type CitySource = "connection" | "location" | null;

export function useCityAutofill(city: string, setCity: (c: string) => void, lang: string, enabled = true) {
  const [source, setSource] = useState<CitySource>(null);
  const [locating, setLocating] = useState(false);
  const [failed, setFailed] = useState(false);
  const current = useRef(city);
  current.current = city;
  const touched = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/whereami", { cache: "no-store" });
        if (!res.ok) return;
        const g = Guess.safeParse(await res.json());
        const guess = g.success ? g.data.city?.trim() : "";
        if (alive && guess && !current.current.trim() && !touched.current) {
          setCity(guess.slice(0, 60));
          setSource("connection");
        }
      } catch {
        /* no guess is fine */
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  /** Call from the input's onChange: typing owns the field from then on. */
  const typed = useCallback(() => {
    touched.current = true;
    setSource(null);
    setFailed(false);
  }, []);

  const useMyLocation = useCallback(() => {
    if (locating) return;
    setFailed(false);
    if (typeof navigator === "undefined" || !navigator.geolocation) return setFailed(true);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const q = new URLSearchParams({ lat: String(pos.coords.latitude), lng: String(pos.coords.longitude), lang: htmlLang(lang) });
          const res = await fetch(`/api/geocode/reverse?${q}`, { cache: "no-store" });
          const f = res.ok ? Found.safeParse(await res.json()) : null;
          if (f?.success) {
            setCity(f.data.city.slice(0, 60));
            setSource("location");
          } else setFailed(true);
        } catch {
          setFailed(true);
        }
        setLocating(false);
      },
      () => {
        setFailed(true);
        setLocating(false);
      },
      { timeout: 10_000, maximumAge: 10 * 60_000, enableHighAccuracy: false },
    );
  }, [lang, locating, setCity]);

  return { source, locating, failed, typed, useMyLocation };
}
