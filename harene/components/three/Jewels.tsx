"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Float, MeshTransmissionMaterial } from "@react-three/drei";
import * as THREE from "three";

/** A brilliant-cut style gem built from two cones — refractive glass material. */
export function Diamond({
  scale = 1,
  color = "#eaf2ff",
}: {
  scale?: number;
  color?: string;
}) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.35;
  });
  return (
    <group ref={ref} scale={scale}>
      {/* crown */}
      <mesh position={[0, 0.32, 0]}>
        <coneGeometry args={[1, 0.62, 8, 1]} />
        <MeshTransmissionMaterial
          thickness={1.4}
          roughness={0.02}
          transmission={1}
          ior={2.4}
          chromaticAberration={0.6}
          anisotropy={0.3}
          distortion={0.2}
          distortionScale={0.3}
          temporalDistortion={0.1}
          color={color}
          background={new THREE.Color("#0c0b0a")}
        />
      </mesh>
      {/* pavilion */}
      <mesh position={[0, -0.42, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[1, 1.15, 8, 1]} />
        <MeshTransmissionMaterial
          thickness={1.6}
          roughness={0.02}
          transmission={1}
          ior={2.4}
          chromaticAberration={0.7}
          anisotropy={0.3}
          color={color}
          background={new THREE.Color("#0c0b0a")}
        />
      </mesh>
    </group>
  );
}

/** A polished gold band. */
export function GoldRing({
  radius = 1.6,
  tube = 0.12,
  rotation = [0, 0, 0],
  speed = 0.2,
}: {
  radius?: number;
  tube?: number;
  rotation?: [number, number, number];
  speed?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.z += dt * speed;
  });
  return (
    <mesh ref={ref} rotation={rotation}>
      <torusGeometry args={[radius, tube, 48, 120]} />
      <meshStandardMaterial
        color="#c9a96a"
        metalness={1}
        roughness={0.18}
        envMapIntensity={1.6}
      />
    </mesh>
  );
}

/** A small floating gem accent. */
export function GemShard({
  position,
  color,
  scale = 0.4,
}: {
  position: [number, number, number];
  color: string;
  scale?: number;
}) {
  return (
    <Float speed={2} rotationIntensity={1.5} floatIntensity={1.6}>
      <mesh position={position} scale={scale}>
        <octahedronGeometry args={[1, 0]} />
        <MeshTransmissionMaterial
          thickness={0.6}
          roughness={0.05}
          transmission={1}
          ior={2.2}
          chromaticAberration={0.5}
          color={color}
          background={new THREE.Color("#0c0b0a")}
        />
      </mesh>
    </Float>
  );
}
