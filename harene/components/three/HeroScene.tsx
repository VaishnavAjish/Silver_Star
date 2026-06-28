"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import {
  Environment,
  Lightformer,
  Float,
  Sparkles,
  Center,
} from "@react-three/drei";
import { Diamond, GoldRing, GemShard } from "./Jewels";

function Scene() {
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 8, 5]} intensity={2.2} color="#fff4d6" />
      <directionalLight position={[-6, -2, -4]} intensity={0.8} color="#9fb8ff" />
      <pointLight position={[0, 0, 4]} intensity={1.4} color="#c9a96a" />

      <Center>
        <Float speed={1.4} rotationIntensity={0.4} floatIntensity={0.8}>
          <Diamond scale={1.15} />
          <GoldRing radius={1.95} tube={0.055} rotation={[Math.PI / 2.1, 0, 0]} speed={0.18} />
          <GoldRing radius={2.35} tube={0.04} rotation={[Math.PI / 2.6, 0.4, 0]} speed={-0.12} />
        </Float>
      </Center>

      <GemShard position={[-3.2, 1.4, -1]} color="#f6dcae" scale={0.35} />
      <GemShard position={[3.1, -1.2, -0.5]} color="#eaf1ff" scale={0.45} />
      <GemShard position={[2.6, 1.8, -2]} color="#dfe9ff" scale={0.28} />
      <GemShard position={[-2.7, -1.7, -1.5]} color="#fff2cf" scale={0.32} />

      <Sparkles
        count={60}
        scale={[10, 6, 4]}
        size={2}
        speed={0.3}
        opacity={0.5}
        color="#c9a96a"
      />

      {/* Reflective studio environment — built in-scene, no external HDR fetch */}
      <Environment resolution={256}>
        <group rotation={[-Math.PI / 3, 0, 0]}>
          <Lightformer
            intensity={4}
            position={[0, 5, -9]}
            scale={[12, 12, 1]}
            color="#fff6e0"
          />
          <Lightformer
            intensity={2}
            position={[-5, 1, -1]}
            scale={[8, 2, 1]}
            color="#c9a96a"
          />
          <Lightformer
            intensity={2}
            position={[5, -1, -1]}
            scale={[8, 2, 1]}
            color="#9fb8ff"
          />
          <Lightformer
            intensity={3}
            position={[0, -4, 2]}
            scale={[10, 3, 1]}
            color="#ffffff"
          />
        </group>
      </Environment>
    </>
  );
}

export function HeroScene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 7], fov: 38 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 2]}
      className="!absolute inset-0"
    >
      <Suspense fallback={null}>
        <Scene />
      </Suspense>
    </Canvas>
  );
}
