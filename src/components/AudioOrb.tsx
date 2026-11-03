import React, { useEffect, useRef } from 'react';

interface AudioOrbProps {
  state: 'idle' | 'listening' | 'processing' | 'speaking' | 'interrupted';
  volume?: number;
  primaryColor?: string;
  onOrbClick?: () => void;
}

export const AudioOrb: React.FC<AudioOrbProps> = ({
  state,
  volume = 0.5,
  primaryColor = '#10B981',
  onOrbClick,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Dynamic canvas wave bars animation with DPR scaling, idle pausing, and reduced motion respect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Device Pixel Ratio scaling for retina rendering
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const displayWidth = 130;
    const displayHeight = 50;

    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    ctx.scale(dpr, dpr);

    // Check prefers-reduced-motion
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let animationFrameId: number;
    let phase = 0;

    const renderStaticBars = () => {
      ctx.clearRect(0, 0, displayWidth, displayHeight);
      const centerY = displayHeight / 2;
      const numBars = 24;
      const barWidth = 3;
      const spacing = 3;
      const startX = (displayWidth - (numBars * (barWidth + spacing))) / 2;

      ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
      for (let i = 0; i < numBars; i++) {
        const barHeight = 4;
        const x = startX + i * (barWidth + spacing);
        const y = centerY - barHeight / 2;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 1.5);
        ctx.fill();
      }
    };

    // If state is idle or reduced-motion is requested, draw static bars and don't loop
    if (state === 'idle' || prefersReducedMotion) {
      renderStaticBars();
      return;
    }

    const render = () => {
      // Pause if tab is backgrounded
      if (typeof document !== 'undefined' && document.hidden) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      ctx.clearRect(0, 0, displayWidth, displayHeight);
      const centerY = displayHeight / 2;

      const numBars = 24;
      const barWidth = 3;
      const spacing = 3;
      const startX = (displayWidth - (numBars * (barWidth + spacing))) / 2;

      for (let i = 0; i < numBars; i++) {
        let barHeight = 4;

        if (state === 'speaking') {
          const wave1 = Math.sin(phase + i * 0.35) * 16;
          const wave2 = Math.cos(phase * 1.3 + i * 0.45) * 10;
          barHeight = Math.max(4, Math.abs(wave1 + wave2));
        } else if (state === 'listening') {
          const wave = Math.sin(phase * 0.8 + i * 0.3) * 10;
          barHeight = Math.max(4, Math.abs(wave) + (volume * 14));
        } else if (state === 'processing') {
          barHeight = 4 + Math.sin(phase * 2 + i * 0.4) * 5;
        } else if (state === 'interrupted') {
          barHeight = i % 2 === 0 ? 14 : 4;
        }

        const x = startX + i * (barWidth + spacing);
        const y = centerY - barHeight / 2;

        let fillStyle = 'rgba(148, 163, 184, 0.4)';
        if (state === 'speaking') {
          const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
          gradient.addColorStop(0, '#818CF8');
          gradient.addColorStop(1, '#6366F1');
          fillStyle = gradient as any;
        } else if (state === 'listening') {
          fillStyle = '#10B981';
        } else if (state === 'processing') {
          fillStyle = '#F59E0B';
        } else if (state === 'interrupted') {
          fillStyle = '#EF4444';
        }

        ctx.fillStyle = fillStyle;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 1.5);
        ctx.fill();
      }

      phase += 0.08;
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [state, volume]);

  const getStateConfig = () => {
    switch (state) {
      case 'listening':
        return {
          label: 'Audio Stream Active',
          subtext: 'Listening to your voice...',
          outerGlow: 'rgba(16, 185, 129, 0.35)',
          coreGradient: 'radial-gradient(circle at 35% 35%, #6EE7B7 0%, #10B981 45%, #064E3B 100%)',
          ringColor: 'border-emerald-500/40',
          textColor: 'text-emerald-400',
        };
      case 'processing':
        return {
          label: 'Synthesizing Response',
          subtext: 'Processing knowledge & tools...',
          outerGlow: 'rgba(245, 158, 11, 0.35)',
          coreGradient: 'radial-gradient(circle at 35% 35%, #FDE68A 0%, #F59E0B 45%, #78350F 100%)',
          ringColor: 'border-amber-500/40',
          textColor: 'text-amber-400',
        };
      case 'speaking':
        return {
          label: 'Agent Speaking',
          subtext: 'Tap anywhere to interrupt (Barge-in)',
          outerGlow: 'rgba(99, 102, 241, 0.45)',
          coreGradient: 'radial-gradient(circle at 35% 35%, #C7D2FE 0%, #6366F1 50%, #312E81 100%)',
          ringColor: 'border-indigo-500/50',
          textColor: 'text-indigo-300',
        };
      case 'interrupted':
        return {
          label: 'Barge-In Interruption',
          subtext: 'Audio cancelled • Listening to user',
          outerGlow: 'rgba(239, 68, 68, 0.45)',
          coreGradient: 'radial-gradient(circle at 35% 35%, #FECACA 0%, #EF4444 50%, #7F1D1D 100%)',
          ringColor: 'border-rose-500/50',
          textColor: 'text-rose-400',
        };
      case 'idle':
      default:
        return {
          label: 'Voice Engine Standby',
          subtext: 'Click Start Voice Call to begin',
          outerGlow: 'rgba(51, 65, 85, 0.25)',
          coreGradient: 'radial-gradient(circle at 35% 35%, #CBD5E1 0%, #475569 50%, #0F172A 100%)',
          ringColor: 'border-slate-700/30',
          textColor: 'text-slate-400',
        };
    }
  };

  const config = getStateConfig();

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOrbClick?.();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-3 select-none">
      {/* Visualizer Aura Stage - Keyboard Accessible */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`Voice orb status: ${config.label}. ${config.subtext}`}
        onKeyDown={handleKeyDown}
        onClick={onOrbClick}
        className="relative flex items-center justify-center w-60 h-60 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-full"
      >
        {/* Ambient Bloom */}
        <div
          className="absolute inset-0 rounded-full transition-all duration-700 blur-3xl opacity-50"
          style={{ background: config.outerGlow }}
        />

        {/* Outer Orbit Harmonic Ring 1 */}
        <div
          className={`absolute inset-3 rounded-full border border-dashed transition-all duration-500 ${config.ringColor} ${
            state === 'speaking' || state === 'listening'
              ? 'animate-[spin_20s_linear_infinite]'
              : 'opacity-40'
          }`}
        />

        {/* Inner Counter Orbit Ring 2 */}
        <div
          className={`absolute inset-8 rounded-full border transition-all duration-500 ${config.ringColor} ${
            state === 'processing'
              ? 'animate-[spin_8s_linear_infinite_reverse]'
              : 'opacity-30'
          }`}
        />

        {/* 3D Core Sphere */}
        <div
          className="relative z-10 w-36 h-36 rounded-full flex flex-col items-center justify-center shadow-2xl transition-all duration-500 overflow-hidden transform hover:scale-105 active:scale-95"
          style={{
            background: config.coreGradient,
            boxShadow: `0 0 45px ${config.outerGlow}, inset 0 -6px 12px rgba(0,0,0,0.4)`,
          }}
        >
          {/* Sphere Internal Light Sheen */}
          <div className="absolute -top-10 -left-10 w-24 h-24 bg-white/25 rounded-full blur-md pointer-events-none" />

          {/* Canvas Spectrum Bar Waveform */}
          <canvas
            ref={canvasRef}
            style={{ width: '130px', height: '50px' }}
            className="relative z-20 pointer-events-none opacity-90"
          />

          <span className="text-xs font-mono tracking-wider uppercase font-semibold text-white/90 mt-1">
            {state === 'speaking'
              ? 'LIVE AUDIO'
              : state === 'listening'
              ? 'HEARING'
              : state === 'processing'
              ? 'THINKING'
              : state === 'interrupted'
              ? 'BARGE-IN'
              : 'STANDBY'}
          </span>
        </div>
      </div>

      {/* State Caption & Telemetry Note */}
      <div className="mt-2 text-center">
        <h4 className={`text-sm font-semibold tracking-tight ${config.textColor}`}>
          {config.label}
        </h4>
        <p className="text-xs text-slate-400 mt-0.5 font-normal">
          {config.subtext}
        </p>
      </div>
    </div>
  );
};
