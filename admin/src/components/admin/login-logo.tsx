/**
 * 管理端登录页图标：轨道 V（Ideve 选定的方案 A）。
 * 纯 SVG + CSS 光晕，没有位图、没有文字，任何尺寸都清晰；三套皮肤统一用这一个。
 * 风格对齐启动页（#vxsplash .vxs-logo / .vxs-orbit）：电光蓝 V + 倾斜轨道环 + 柔光。
 */
import "./login-logo.css";

/**
 * VEXO 丝带 V（照 Ideve 的参考图重画）：
 * 左臂是一把白→银→蓝的厚刀片；右臂是一条扭转的电光蓝丝带，顶端向左折回、甩出一个弧形尖角。
 * 坐标按参考图 1000×680 的描图网格写，再整体缩放进 120×120 的画布。
 */
function VGlyph({ id }: { id: string }) {
  return (
    <g transform="translate(24.4 32.9) scale(0.072)">
      {/* 右臂主体：深蓝丝带，压在左臂下面 */}
      <path
        d="M505 322 C540 280 590 236 650 221 L842 216 L512 652 L470 600 Z"
        fill={`url(#${id}-body)`}
      />
      {/* 主体里的一条亮带：丝带扭转处的反光 */}
      <path
        d="M752 268 L604 486"
        fill="none"
        stroke="#5FC0FF"
        strokeWidth="64"
        strokeLinecap="round"
        opacity="0.85"
        filter={`url(#${id}-soft)`}
      />
      {/* 折回的顶端：浅青蓝翻面 */}
      <path
        d="M505 322 C560 232 622 142 684 94 C724 62 762 46 806 46 L972 46 L842 216 L650 221 C592 234 542 278 505 322 Z"
        fill={`url(#${id}-flap)`}
      />
      {/* 折痕暗线：翻面和主体的分界 */}
      <path
        d="M505 322 C542 278 592 234 650 221 L842 216"
        fill="none"
        stroke="#0B2E9A"
        strokeOpacity="0.55"
        strokeWidth="6"
      />
      {/* 丝带外缘与翻面上缘的高光 */}
      <path
        d="M972 46 L512 652"
        fill="none"
        stroke="#9EDCFF"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d="M505 322 C560 232 622 142 684 94 C724 62 762 46 806 46 L960 46"
        fill="none"
        stroke="#E4F6FF"
        strokeWidth="5"
        strokeLinecap="round"
        opacity="0.9"
      />
      {/* 左臂背后的一道蓝色边光（参考图左侧那条细弧） */}
      <path
        d="M26 52 C92 170 172 330 252 452 C300 522 350 560 404 566"
        fill="none"
        stroke={`url(#${id}-rim)`}
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* 左臂：白→银→蓝的刀片 */}
      <path
        d="M20 45 L232 45 Q284 45 312 86 L600 496 L512 652 L392 452 C330 360 282 292 214 210 C150 132 92 70 20 45 Z"
        fill={`url(#${id}-blade)`}
      />
      {/* 亮色模式才显示的刀片描边，避免白刀片融进浅色背景 */}
      <path
        className="vx-ll-bladeedge"
        d="M20 45 L232 45 Q284 45 312 86 L600 496 L512 652 L392 452 C330 360 282 292 214 210 C150 132 92 70 20 45 Z"
        fill="none"
        stroke="#1B3A8A"
        strokeWidth="5"
        strokeLinejoin="round"
        opacity="0"
      />
      {/* 刀片右缘的一道亮边 */}
      <path
        d="M312 86 L600 496"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity="0.75"
        strokeWidth="4"
      />
    </g>
  );
}

function VDefs({ id }: { id: string }) {
  return (
    <>
      <linearGradient
        id={`${id}-blade`}
        x1="120"
        y1="45"
        x2="560"
        y2="640"
        gradientUnits="userSpaceOnUse"
      >
        <stop className="vx-ll-b0" offset="0" stopColor="#FFFFFF" />
        <stop className="vx-ll-b1" offset="0.3" stopColor="#E9EEFB" />
        <stop className="vx-ll-b2" offset="0.58" stopColor="#AEBDEB" />
        <stop offset="0.8" stopColor="#4F82F5" />
        <stop offset="1" stopColor="#1E6BFF" />
      </linearGradient>
      <linearGradient
        id={`${id}-body`}
        x1="520"
        y1="300"
        x2="860"
        y2="560"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0" stopColor="#020A2C" />
        <stop offset="0.55" stopColor="#0B2E9A" />
        <stop offset="1" stopColor="#2373FF" />
      </linearGradient>
      <filter id={`${id}-soft`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="12" />
      </filter>
      <linearGradient
        id={`${id}-rim`}
        x1="26"
        y1="52"
        x2="404"
        y2="566"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0" stopColor="#3D8BFF" stopOpacity="0.15" />
        <stop offset="0.6" stopColor="#3D8BFF" stopOpacity="0.85" />
        <stop offset="1" stopColor="#3D8BFF" stopOpacity="0.1" />
      </linearGradient>
      <linearGradient
        id={`${id}-flap`}
        x1="520"
        y1="300"
        x2="960"
        y2="60"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0" stopColor="#1B5BFF" />
        <stop offset="0.45" stopColor="#3C9BFF" />
        <stop offset="1" stopColor="#7FD8FF" />
      </linearGradient>
    </>
  );
}

/** 轨道 V：启动页同款倾斜轨道环 + 轨道上一个“控制节点”（管理端标识）。 */
function LogoOrbit({ className }: { className?: string }) {
  const id = "llA";
  return (
    <svg
      className={`vx-ll vx-ll-a ${className ?? ""}`}
      viewBox="0 0 120 120"
      role="img"
      aria-label="VEXO 管理端"
    >
      <defs>
        <VDefs id={id} />
        <radialGradient id={`${id}-halo`} cx="60" cy="60" r="38" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2F7BFF" stopOpacity="0.32" />
          <stop offset="0.6" stopColor="#2F7BFF" stopOpacity="0.08" />
          <stop offset="1" stopColor="#2F7BFF" stopOpacity="0" />
        </radialGradient>
        <linearGradient
          id={`${id}-orb`}
          x1="0"
          y1="0"
          x2="120"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop className="vx-ll-o0" offset="0" stopColor="#82BEFF" stopOpacity="0.15" />
          <stop className="vx-ll-o1" offset="0.5" stopColor="#9FD0FF" stopOpacity="0.6" />
          <stop className="vx-ll-o2" offset="1" stopColor="#E6F4FF" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="38" fill={`url(#${id}-halo)`} />
      <g transform="rotate(-16 60 60)">
        {/* 轨道后半圈：在 V 后面 */}
        <path
          d="M6 60 A54 20 0 0 1 114 60"
          fill="none"
          stroke={`url(#${id}-orb)`}
          strokeWidth="1.4"
          opacity="0.7"
        />
      </g>
      <g className="vx-ll-glyph">
        <VGlyph id={id} />
      </g>
      <g transform="rotate(-16 60 60)">
        {/* 轨道前半圈：压在 V 前面 */}
        <path
          d="M114 60 A54 20 0 0 1 6 60"
          fill="none"
          stroke={`url(#${id}-orb)`}
          strokeWidth="1.8"
        />
        <path
          className="vx-ll-arc"
          d="M88 77.4 A54 20 0 0 0 112 66"
          fill="none"
          stroke="#EAF6FF"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        {/* 控制节点：管理端标识 */}
        <circle
          className="vx-ll-node"
          cx="112"
          cy="65.4"
          r="4.6"
          fill="#050B1E"
          stroke="#BFE2FF"
          strokeWidth="1.4"
        />
        <circle className="vx-ll-dot" cx="112" cy="65.4" r="1.9" fill="#FFFFFF" />
      </g>
    </svg>
  );
}

/**
 * 登录页图标。占位保持原来的 72px，图形居中向外溢出，
 * 所以下面的 VEXO / 管理端 / 表单位置与原来完全一致。
 */
export function AdminLoginLogo() {
  return (
    <div className="relative grid size-[72px] place-items-center overflow-visible">
      <LogoOrbit className="absolute size-[150px] max-w-none" />
    </div>
  );
}
