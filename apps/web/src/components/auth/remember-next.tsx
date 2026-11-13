"use client";

import { useEffect } from "react";
import { rememberNextFromURL } from "@/lib/next-path";

/** On the sign-in pages: keep ?next= so the visitor ends up where they meant to go. */
export function RememberNext() {
  useEffect(() => {
    rememberNextFromURL();
  }, []);
  return null;
}
