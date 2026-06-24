import React from "react";
import { StudioScreen } from "@/src/StudioScreen";
import { VideoRenderer, parseSpec } from "@/src/Renderers";

export default function Video() {
  return (
    <StudioScreen
      mode="video"
      modeCode="02"
      modeLabel="3D VIDEO"
      modeSub="Timeline sequencer"
      placeholder="E.G. A MOODY NEO-NOIR CHASE SEQUENCE, 15 SECONDS"
      renderOutput={(text) => {
        const spec = parseSpec(text) || { duration_s: 10, tracks: [] };
        return <VideoRenderer spec={spec as any} />;
      }}
    />
  );
}
