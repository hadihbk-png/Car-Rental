import type { ReactNode, SVGProps } from "react";

/** Small inline stroke icons (24x24 grid). Decorative by default; pass `aria-label` + `aria-hidden={false}` to expose. */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function make(paths: ReactNode, displayName: string) {
  function Icon({ size = 20, ...props }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...props}
      >
        {paths}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

export const MenuIcon = make(<path d="M4 6h16M4 12h16M4 18h16" />, "MenuIcon");
export const CloseIcon = make(<path d="M6 6l12 12M18 6L6 18" />, "CloseIcon");
export const ChevronLeftIcon = make(<path d="M15 18l-6-6 6-6" />, "ChevronLeftIcon");
export const ChevronRightIcon = make(<path d="M9 18l6-6-6-6" />, "ChevronRightIcon");
export const ChevronDownIcon = make(<path d="M6 9l6 6 6-6" />, "ChevronDownIcon");
export const CheckIcon = make(<path d="M5 12.5l4.5 4.5L19 7.5" />, "CheckIcon");
export const SearchIcon = make(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </>,
  "SearchIcon",
);
export const CarIcon = make(
  <>
    <path d="M5 16H3.5a.5.5 0 01-.5-.5V13a2 2 0 011.2-1.8L6 10.5l1.6-3.4A2 2 0 019.4 6h5.2a2 2 0 011.8 1.1L18 10.5l1.8.7A2 2 0 0121 13v2.5a.5.5 0 01-.5.5H19" />
    <circle cx="7.5" cy="16.5" r="2" />
    <circle cx="16.5" cy="16.5" r="2" />
    <path d="M9.5 16.5h5M6 10.5h12" />
  </>,
  "CarIcon",
);
export const CalendarIcon = make(
  <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </>,
  "CalendarIcon",
);
export const ClockIcon = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>,
  "ClockIcon",
);
export const MapPinIcon = make(
  <>
    <path d="M12 21s-7-6.1-7-11.5a7 7 0 0114 0C19 14.9 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </>,
  "MapPinIcon",
);
export const SeatIcon = make(
  <>
    <circle cx="9" cy="7" r="3" />
    <path d="M3.5 20a5.5 5.5 0 0111 0M16 4.5a3 3 0 010 5.5M18 14.5a5.5 5.5 0 012.5 5.5" />
  </>,
  "SeatIcon",
);
export const GearIcon = make(
  <>
    <circle cx="6" cy="6" r="2" />
    <circle cx="12" cy="6" r="2" />
    <circle cx="18" cy="6" r="2" />
    <circle cx="6" cy="18" r="2" />
    <circle cx="12" cy="18" r="2" />
    <path d="M6 8v8M12 8v8M18 8v4H6" />
  </>,
  "GearIcon",
);
export const FuelIcon = make(
  <>
    <path d="M4 20V5a2 2 0 012-2h6a2 2 0 012 2v15M3 20h12M4 10h10" />
    <path d="M14 8h2a2 2 0 012 2v6a1.5 1.5 0 003 0V9l-3-3" />
  </>,
  "FuelIcon",
);
export const FilterIcon = make(<path d="M4 5h16M7 12h10M10 19h4" />, "FilterIcon");
export const UploadIcon = make(<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />, "UploadIcon");
export const FileIcon = make(
  <>
    <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
    <path d="M14 3v5h5" />
  </>,
  "FileIcon",
);
export const InfoIcon = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </>,
  "InfoIcon",
);
export const CheckCircleIcon = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l2.5 2.5L16 9.5" />
  </>,
  "CheckCircleIcon",
);
export const AlertTriangleIcon = make(
  <>
    <path d="M10.3 4.2L2.6 17.5A2 2 0 004.3 20.5h15.4a2 2 0 001.7-3L13.7 4.2a2 2 0 00-3.4 0z" />
    <path d="M12 9.5v4M12 17h.01" />
  </>,
  "AlertTriangleIcon",
);
export const AlertCircleIcon = make(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5h.01" />
  </>,
  "AlertCircleIcon",
);
export const UserIcon = make(
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20.5a8 8 0 0116 0" />
  </>,
  "UserIcon",
);
export const LogOutIcon = make(<path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 16l-4-4 4-4M6 12h10" />, "LogOutIcon");
export const ShieldIcon = make(
  <>
    <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z" />
    <path d="M9 12l2 2 4-4" />
  </>,
  "ShieldIcon",
);
export const ArrowRightIcon = make(<path d="M5 12h14M13 6l6 6-6 6" />, "ArrowRightIcon");
export const SwapIcon = make(<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7" />, "SwapIcon");
export const LayoutIcon = make(
  <>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
    <path d="M3.5 9.5h17M9.5 9.5v11" />
  </>,
  "LayoutIcon",
);
export const KeyIcon = make(
  <>
    <circle cx="8" cy="15" r="4" />
    <path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2" />
  </>,
  "KeyIcon",
);
export const ReturnIcon = make(<path d="M9 14l-5-5 5-5M4 9h10.5a5.5 5.5 0 010 11H11" />, "ReturnIcon");
export const TagIcon = make(
  <>
    <path d="M3 12V4a1 1 0 011-1h8l9 9-9 9z" />
    <circle cx="7.5" cy="7.5" r="1.5" />
  </>,
  "TagIcon",
);
export const BuildingIcon = make(
  <>
    <path d="M4 21V5a2 2 0 012-2h8a2 2 0 012 2v16M16 9h2a2 2 0 012 2v10M2 21h20" />
    <path d="M8 7h4M8 11h4M8 15h4" />
  </>,
  "BuildingIcon",
);
export const WrenchIcon = make(
  <path d="M14.7 6.3a4 4 0 005 5L21 13l-8 8-2.5-2.5M14.7 6.3L13 4.6a4 4 0 00-5.7 5.6L3 14.5 9.5 21l4.3-4.3a4 4 0 005.6-5.7" />,
  "WrenchIcon",
);
export const ClipboardIcon = make(
  <>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" />
  </>,
  "ClipboardIcon",
);
export const LuggageIcon = make(
  <>
    <rect x="5" y="7" width="14" height="13" rx="2" />
    <path d="M9 7V4h6v3M9 11v5M15 11v5" />
  </>,
  "LuggageIcon",
);
