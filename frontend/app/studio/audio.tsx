import React from "react";
import { StudioScreen } from "@/src/StudioScreen";
import { AudioRenderer, parseSpec } from "@/src/Renderers";

export default function Audio() {
  return (
    <StudioScreen
      mode="audio"
      modeCode="04"
      modeLabel="3D AUDIO"
      modeSub="Frequency visualizer"
      placeholder="E.G. AMBIENT TECHNO 110 BPM WITH HAUNTED MELODIES"
      renderOutput={(text) => {
        const spec = parseSpec(text) || { notes: [] };
        return <AudioRenderer spec={spec as any} />;
      }}
    />
  );
}
