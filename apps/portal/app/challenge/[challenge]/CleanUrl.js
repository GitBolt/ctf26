"use client";

import { useEffect } from "react";

export default function CleanUrl() {
  useEffect(() => {
    window.history.replaceState(null, "", "/challenge/last-stop");
  }, []);
  return null;
}
