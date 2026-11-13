// The console's icon set: Phosphor, imported from its server-safe entry so
// server and client components can both use it. Icons keep the names the
// code already used, so call sites read the same.
//
// Phosphor's regular stroke is 1px at our usual 16px size and looks soft, so
// icons default to bold; a weight passed at the call site still wins.
import { createElement, forwardRef } from "react";
import type { Icon, IconProps } from "@phosphor-icons/react/dist/lib/types";
import {
  ArrowElbowDownLeft as PhArrowElbowDownLeft,
  ArrowRight as PhArrowRight,
  ArrowSquareOut as PhArrowSquareOut,
  ArrowUpRight as PhArrowUpRight,
  ArrowsClockwise as PhArrowsClockwise,
  Bell as PhBell,
  BellRinging as PhBellRinging,
  Broadcast as PhBroadcast,
  Buildings as PhBuildings,
  CalendarCheck as PhCalendarCheck,
  CaretDown as PhCaretDown,
  CaretLeft as PhCaretLeft,
  CaretRight as PhCaretRight,
  CaretUpDown as PhCaretUpDown,
  CellTower as PhCellTower,
  ChatText as PhChatText,
  Check as PhCheck,
  CheckCircle as PhCheckCircle,
  CircleDashed as PhCircleDashed,
  CircleNotch as PhCircleNotch,
  ClipboardText as PhClipboardText,
  Clock as PhClock,
  ClockCounterClockwise as PhClockCounterClockwise,
  Cloud as PhCloud,
  Copy as PhCopy,
  CreditCard as PhCreditCard,
  Crosshair as PhCrosshair,
  Database as PhDatabase,
  DeviceMobile as PhDeviceMobile,
  DownloadSimple as PhDownloadSimple,
  Envelope as PhEnvelope,
  EnvelopeOpen as PhEnvelopeOpen,
  Eye as PhEye,
  EyeSlash as PhEyeSlash,
  FileCsv as PhFileCsv,
  FileText as PhFileText,
  Fingerprint as PhFingerprint,
  FlowArrow as PhFlowArrow,
  Gauge as PhGauge,
  Gear as PhGear,
  GearSix as PhGearSix,
  Globe as PhGlobe,
  Graph as PhGraph,
  HardDrive as PhHardDrive,
  HardDrives as PhHardDrives,
  ImageSquare as PhImageSquare,
  Key as PhKey,
  Keyboard as PhKeyboard,
  Laptop as PhLaptop,
  Lightning as PhLightning,
  LinkSimple as PhLinkSimple,
  List as PhList,
  Lock as PhLock,
  LockKey as PhLockKey,
  MagnifyingGlass as PhMagnifyingGlass,
  Minus as PhMinus,
  Monitor as PhMonitor,
  Network as PhNetwork,
  Package as PhPackage,
  PaperPlaneTilt as PhPaperPlaneTilt,
  Path as PhPath,
  PencilSimple as PhPencilSimple,
  Play as PhPlay,
  Plug as PhPlug,
  PlugsConnected as PhPlugsConnected,
  Plus as PhPlus,
  Pulse as PhPulse,
  Question as PhQuestion,
  Robot as PhRobot,
  Scan as PhScan,
  Scroll as PhScroll,
  SealCheck as PhSealCheck,
  Shield as PhShield,
  ShieldCheck as PhShieldCheck,
  ShieldWarning as PhShieldWarning,
  SidebarSimple as PhSidebarSimple,
  SignIn as PhSignIn,
  SignOut as PhSignOut,
  Siren as PhSiren,
  SlidersHorizontal as PhSlidersHorizontal,
  Sparkle as PhSparkle,
  Square as PhSquare,
  SquaresFour as PhSquaresFour,
  Target as PhTarget,
  TerminalWindow as PhTerminalWindow,
  Trash as PhTrash,
  TreeStructure as PhTreeStructure,
  User as PhUser,
  UserCircle as PhUserCircle,
  UserPlus as PhUserPlus,
  Users as PhUsers,
  Warning as PhWarning,
  Info as PhInfo,
  WebhooksLogo as PhWebhooksLogo,
  WifiSlash as PhWifiSlash,
  X as PhX,
  XCircle as PhXCircle,
} from "@phosphor-icons/react/dist/ssr";

export type { Icon as AppIcon, IconWeight } from "@phosphor-icons/react/dist/lib/types";

function bold(Base: Icon): Icon {
  const Wrapped = forwardRef<SVGSVGElement, IconProps>((props, ref) =>
    createElement(Base, { weight: "bold", ...props, ref }),
  );
  Wrapped.displayName = Base.displayName;
  return Wrapped;
}

export const Activity = bold(PhPulse);
export const AlertTriangle = bold(PhWarning);
export const Info = bold(PhInfo);
export const ArrowRight = bold(PhArrowRight);
export const ArrowUpRight = bold(PhArrowUpRight);
export const BadgeCheck = bold(PhSealCheck);
export const Bell = bold(PhBell);
export const BellRing = bold(PhBellRinging);
export const Bot = bold(PhRobot);
export const Boxes = bold(PhPackage);
export const Building2 = bold(PhBuildings);
export const Cable = bold(PhPlugsConnected);
export const CalendarClock = bold(PhCalendarCheck);
export const Check = bold(PhCheck);
export const CheckCircle2 = bold(PhCheckCircle);
export const ChevronDown = bold(PhCaretDown);
export const ChevronLeft = bold(PhCaretLeft);
export const ChevronRight = bold(PhCaretRight);
export const ChevronsUpDown = bold(PhCaretUpDown);
export const CircleDashed = bold(PhCircleDashed);
export const ClipboardCheck = bold(PhClipboardText);
export const Clock = bold(PhClock);
export const Clock3 = bold(PhClock);
export const Cloud = bold(PhCloud);
export const Copy = bold(PhCopy);
export const CornerDownLeft = bold(PhArrowElbowDownLeft);
export const CreditCard = bold(PhCreditCard);
export const Database = bold(PhDatabase);
export const Download = bold(PhDownloadSimple);
export const ExternalLink = bold(PhArrowSquareOut);
export const Eye = bold(PhEye);
export const EyeOff = bold(PhEyeSlash);
export const FileClock = bold(PhClockCounterClockwise);
export const FileSpreadsheet = bold(PhFileCsv);
export const FileText = bold(PhFileText);
export const Fingerprint = bold(PhFingerprint);
export const Gauge = bold(PhGauge);
export const Globe = bold(PhGlobe);
export const HardDrive = bold(PhHardDrive);
export const HelpCircle = bold(PhQuestion);
export const History = bold(PhClockCounterClockwise);
export const ImageUp = bold(PhImageSquare);
export const KeyRound = bold(PhKey);
export const Keyboard = bold(PhKeyboard);
export const Laptop = bold(PhLaptop);
export const LayoutDashboard = bold(PhSquaresFour);
export const Link2 = bold(PhLinkSimple);
export const ListTree = bold(PhTreeStructure);
export const Loader2 = bold(PhCircleNotch);
export const Lock = bold(PhLock);
export const LockKeyhole = bold(PhLockKey);
export const LogIn = bold(PhSignIn);
export const LogOut = bold(PhSignOut);
export const Mail = bold(PhEnvelope);
export const MailCheck = bold(PhEnvelopeOpen);
export const Menu = bold(PhList);
export const MessageSquare = bold(PhChatText);
export const Minus = bold(PhMinus);
export const Monitor = bold(PhMonitor);
export const Network = bold(PhNetwork);
export const PanelLeftClose = bold(PhSidebarSimple);
export const PanelLeftOpen = bold(PhSidebarSimple);
export const Pencil = bold(PhPencilSimple);
export const Play = bold(PhPlay);
export const Plug = bold(PhPlug);
export const Plus = bold(PhPlus);
export const Radar = bold(PhCrosshair);
export const Radio = bold(PhBroadcast);
export const RadioTower = bold(PhCellTower);
export const RefreshCw = bold(PhArrowsClockwise);
export const Route = bold(PhPath);
export const ScanSearch = bold(PhScan);
export const ScrollText = bold(PhScroll);
export const Search = bold(PhMagnifyingGlass);
export const Send = bold(PhPaperPlaneTilt);
export const Server = bold(PhHardDrives);
export const Settings = bold(PhGear);
export const Settings2 = bold(PhGearSix);
export const Shield = bold(PhShield);
export const ShieldAlert = bold(PhShieldWarning);
export const ShieldCheck = bold(PhShieldCheck);
export const Siren = bold(PhSiren);
export const SlidersHorizontal = bold(PhSlidersHorizontal);
export const Smartphone = bold(PhDeviceMobile);
export const Sparkles = bold(PhSparkle);
export const Square = bold(PhSquare);
export const SquareTerminal = bold(PhTerminalWindow);
export const Target = bold(PhTarget);
export const Trash2 = bold(PhTrash);
export const User = bold(PhUser);
export const UserPlus = bold(PhUserPlus);
export const UserRound = bold(PhUserCircle);
export const Users = bold(PhUsers);
export const Waypoints = bold(PhGraph);
export const Webhook = bold(PhWebhooksLogo);
export const WifiOff = bold(PhWifiSlash);
export const Workflow = bold(PhFlowArrow);
export const X = bold(PhX);
export const XCircle = bold(PhXCircle);
export const Zap = bold(PhLightning);
