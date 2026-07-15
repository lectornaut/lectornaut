import {
  ApertureIcon,
  ArrowDownToLineIcon,
  ArrowLeftToLineIcon,
  ArrowRightToLineIcon,
  ArrowUpToLineIcon,
  AtSignIcon,
  BadgeCheckIcon,
  BanIcon,
  BellIcon,
  BellRingIcon,
  BlocksIcon,
  BoldIcon,
  BoltIcon,
  BotIcon,
  BotMessageSquareIcon,
  BoxIcon,
  BracesIcon,
  CheckCheckIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronsDownUpIcon,
  ChevronsLeftRightEllipsisIcon,
  CircleCheckBigIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  CircleDotIcon,
  CirclePlusIcon,
  CircleXIcon,
  CloudCheckIcon,
  CloudRainIcon,
  CloudSyncIcon,
  CodeIcon,
  ContrastIcon,
  DicesIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  FilePlusIcon,
  GraduationCapIcon,
  Grid2X2Icon,
  Grid2X2PlusIcon,
  GripHorizontalIcon,
  GripVerticalIcon,
  HandIcon,
  HashIcon,
  HeartIcon,
  HistoryIcon,
  TableIcon,
  TerminalIcon,
  TextIcon,
  ZapIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/vue"
import type { FunctionalComponent } from "vue"
import { h } from "vue"
import IconBiApple from "~icons/bi/apple"
import IconBxBxsZap from "~icons/bx/bxs-zap"
import IconJapan from "~icons/circle-flags/jp"
import IconUSA from "~icons/circle-flags/us"
import IconHgActivity01 from "~icons/hugeicons/activity-01"
import IconHgAdd01 from "~icons/hugeicons/add-01"
import IconHgAddSquare from "~icons/hugeicons/add-square"
import IconHgAiChip from "~icons/hugeicons/ai-chip"
import IconHgAlert02 from "~icons/hugeicons/alert-02"
import IconHgAlertCircle from "~icons/hugeicons/alert-circle"
import IconHgArchive from "~icons/hugeicons/archive"
import IconHgArrowDown01 from "~icons/hugeicons/arrow-down-01"
import IconHgArrowDown02 from "~icons/hugeicons/arrow-down-02"
import IconHgArrowLeft02 from "~icons/hugeicons/arrow-left-02"
import IconHgArrowLeftRight from "~icons/hugeicons/arrow-left-right"
import IconHgArrowReloadHorizontal from "~icons/hugeicons/arrow-reload-horizontal"
import IconHgArrowRight02 from "~icons/hugeicons/arrow-right-02"
import IconHgArrowTurnBackward from "~icons/hugeicons/arrow-turn-backward"
import IconHgArrowTurnForward from "~icons/hugeicons/arrow-turn-forward"
import IconHgArrowUp02 from "~icons/hugeicons/arrow-up-02"
import IconHgArrowUpDown from "~icons/hugeicons/arrow-up-down"
import IconHgArrowUpRight01 from "~icons/hugeicons/arrow-up-right-01"
import IconHgAsterisk from "~icons/hugeicons/asterisk"
import IconHgAudit01 from "~icons/hugeicons/audit-01"
import IconHgBadgeDollarSign from "~icons/hugeicons/badge-dollar-sign"
import IconHgBookOpen01 from "~icons/hugeicons/book-open-01"
import IconHgBookmark02 from "~icons/hugeicons/bookmark-02"
import IconHgBookmarkCheck01 from "~icons/hugeicons/bookmark-check-01"
import IconHgBrain from "~icons/hugeicons/brain"
import IconHgBriefcase01 from "~icons/hugeicons/briefcase-01"
import IconHgBubbleChat from "~icons/hugeicons/bubble-chat"
import IconHgBuilding06 from "~icons/hugeicons/building-06"
import IconHgCalculator01 from "~icons/hugeicons/calculator-01"
import IconHgCalendar01 from "~icons/hugeicons/calendar-01"
import IconHgCamera01 from "~icons/hugeicons/camera-01"
import IconHgCancel01 from "~icons/hugeicons/cancel-01"
import IconHgCancelCircle from "~icons/hugeicons/cancel-circle"
import IconHgCancelSquare from "~icons/hugeicons/cancel-square"
import IconHgCells from "~icons/hugeicons/cells"
import IconHgCheckList from "~icons/hugeicons/check-list"
import IconHgCheckmarkCircle02 from "~icons/hugeicons/checkmark-circle-02"
import IconHgCheckmarkSquare02 from "~icons/hugeicons/checkmark-square-02"
import IconHgCircle from "~icons/hugeicons/circle"
import IconHgClock01 from "~icons/hugeicons/clock-01"
import IconHgCloudAlert from "~icons/hugeicons/cloud-alert"
import IconHgCombine from "~icons/hugeicons/combine"
import IconHgCommand from "~icons/hugeicons/command"
import IconHgComment01 from "~icons/hugeicons/comment-01"
import IconHgComponent from "~icons/hugeicons/component"
import IconHgComputer from "~icons/hugeicons/computer"
import IconHgCone01 from "~icons/hugeicons/cone-01"
import IconHgCopy01 from "~icons/hugeicons/copy-01"
import IconHgCreditCard from "~icons/hugeicons/credit-card"
import IconHgCursorMagicSelection01 from "~icons/hugeicons/cursor-magic-selection-01"
import IconHgCursorPointer01 from "~icons/hugeicons/cursor-pointer-01"
import IconHgDatabase01 from "~icons/hugeicons/database-01"
import IconHgDelete02 from "~icons/hugeicons/delete-02"
import IconHgDelete03 from "~icons/hugeicons/delete-03"
import IconHgDisc from "~icons/hugeicons/disc"
import IconHgDownload04 from "~icons/hugeicons/download-04"
import IconHgEdit01 from "~icons/hugeicons/edit-01"
import IconHgEdit02 from "~icons/hugeicons/edit-02"
import IconHgFile01 from "~icons/hugeicons/file-01"
import IconHgFile02 from "~icons/hugeicons/file-02"
import IconHgFilter from "~icons/hugeicons/filter"
import IconHgFolder01 from "~icons/hugeicons/folder-01"
import IconHgFolderAdd from "~icons/hugeicons/folder-add"
import IconHgFolderOpen from "~icons/hugeicons/folder-open"
import IconHgFullSignal from "~icons/hugeicons/full-signal"
import IconHgGalleryHorizontalEnd from "~icons/hugeicons/gallery-horizontal-end"
import IconHgGift from "~icons/hugeicons/gift"
import IconHgGlobe from "~icons/hugeicons/globe"
import IconHgGridView from "~icons/hugeicons/grid-view"
import IconHgGroup from "~icons/hugeicons/group"
import IconHgHardDrive from "~icons/hugeicons/hard-drive"
import IconHgHeading01 from "~icons/hugeicons/heading-01"
import IconHgHeading02 from "~icons/hugeicons/heading-02"
import IconHgHeading03 from "~icons/hugeicons/heading-03"
import IconHgHelpCircle from "~icons/hugeicons/help-circle"
import IconHgHighlighter from "~icons/hugeicons/highlighter"
import IconHgHome01 from "~icons/hugeicons/home-01"
import IconHgHourglass from "~icons/hugeicons/hourglass"
import IconHgImage01 from "~icons/hugeicons/image-01"
import IconHgInbox from "~icons/hugeicons/inbox"
import IconHgInformationCircle from "~icons/hugeicons/information-circle"
import IconHgKey01 from "~icons/hugeicons/key-01"
import IconHgKeyboard from "~icons/hugeicons/keyboard"
import IconHgLaptop from "~icons/hugeicons/laptop"
import IconHgLayers01 from "~icons/hugeicons/layers-01"
import IconHgLayout2Column from "~icons/hugeicons/layout-2-column"
import IconHgLayout2Row from "~icons/hugeicons/layout-2-row"
import IconHgLayoutBottom from "~icons/hugeicons/layout-bottom"
import IconHgLeaf01 from "~icons/hugeicons/leaf-01"
import IconHgLeftToRightListBullet from "~icons/hugeicons/left-to-right-list-bullet"
import IconHgLeftToRightListDash from "~icons/hugeicons/left-to-right-list-dash"
import IconHgLeftToRightListNumber from "~icons/hugeicons/left-to-right-list-number"
import IconHgLifebuoy from "~icons/hugeicons/lifebuoy"
import IconHgLink01 from "~icons/hugeicons/link-01"
import IconHgLink02 from "~icons/hugeicons/link-02"
import IconHgLoading03 from "~icons/hugeicons/loading-03"
import IconHgLock from "~icons/hugeicons/lock"
import IconHgLogout01 from "~icons/hugeicons/logout-01"
import IconHgLowSignal from "~icons/hugeicons/low-signal"
import IconHgMail01 from "~icons/hugeicons/mail-01"
import IconHgMapPin from "~icons/hugeicons/map-pin"
import IconHgMaximize01 from "~icons/hugeicons/maximize-01"
import IconHgMediumSignal from "~icons/hugeicons/medium-signal"
import IconHgMenu01 from "~icons/hugeicons/menu-01"
import IconHgMessageMultiple01 from "~icons/hugeicons/message-multiple-01"
import IconHgMic01 from "~icons/hugeicons/mic-01"
import IconHgMinimize01 from "~icons/hugeicons/minimize-01"
import IconHgMinusSign from "~icons/hugeicons/minus-sign"
import IconHgMoon02 from "~icons/hugeicons/moon-02"
import IconHgMoonEclipse from "~icons/hugeicons/moon-eclipse"
import IconHgMoreHorizontal from "~icons/hugeicons/more-horizontal"
import IconHgMoreVertical from "~icons/hugeicons/more-vertical"
import IconHgPaintBoard from "~icons/hugeicons/paint-board"
import IconHgPanelBottomClose from "~icons/hugeicons/panel-bottom-close"
import IconHgPanelLeft from "~icons/hugeicons/panel-left"
import IconHgPanelLeftClose from "~icons/hugeicons/panel-left-close"
import IconHgPanelRight from "~icons/hugeicons/panel-right"
import IconHgPanelRightClose from "~icons/hugeicons/panel-right-close"
import IconHgPause from "~icons/hugeicons/pause"
import IconHgPauseCircle from "~icons/hugeicons/pause-circle"
import IconHgPencilEdit02 from "~icons/hugeicons/pencil-edit-02"
import IconHgPencilRuler from "~icons/hugeicons/pencil-ruler"
import IconHgPictureInPictureExit from "~icons/hugeicons/picture-in-picture-exit"
import IconHgPictureInPictureOn from "~icons/hugeicons/picture-in-picture-on"
import IconHgPin from "~icons/hugeicons/pin"
import IconHgPinOff from "~icons/hugeicons/pin-off"
import IconHgPlay from "~icons/hugeicons/play"
import IconHgPlayCircle from "~icons/hugeicons/play-circle"
import IconHgPlug01 from "~icons/hugeicons/plug-01"
import IconHgQuoteUp from "~icons/hugeicons/quote-up"
import IconHgRefresh from "~icons/hugeicons/refresh"
import IconHgRemoveCircle from "~icons/hugeicons/remove-circle"
import IconHgRemoveSquare from "~icons/hugeicons/remove-square"
import IconHgRepeat from "~icons/hugeicons/repeat"
import IconHgRocket01 from "~icons/hugeicons/rocket-01"
import IconHgRotateLeft01 from "~icons/hugeicons/rotate-left-01"
import IconHgScroll from "~icons/hugeicons/scroll"
import IconHgSearch01 from "~icons/hugeicons/search-01"
import IconHgSent from "~icons/hugeicons/sent"
import IconHgSettings01 from "~icons/hugeicons/settings-01"
import IconHgSettings02 from "~icons/hugeicons/settings-02"
import IconHgShield01 from "~icons/hugeicons/shield-01"
import IconHgSmartPhone01 from "~icons/hugeicons/smart-phone-01"
import IconHgSmile from "~icons/hugeicons/smile"
import IconHgSparkles from "~icons/hugeicons/sparkles"
import IconHgSplit from "~icons/hugeicons/split"
import IconHgSquare from "~icons/hugeicons/square"
import IconHgSquareArrowUpRight from "~icons/hugeicons/square-arrow-up-right"
import IconHgSquareMousePointer from "~icons/hugeicons/square-mouse-pointer"
import IconHgStar from "~icons/hugeicons/star"
import IconHgStarOff from "~icons/hugeicons/star-off"
import IconHgSun02 from "~icons/hugeicons/sun-02"
import IconHgTableColumnsSplit from "~icons/hugeicons/table-columns-split"
import IconHgTablet01 from "~icons/hugeicons/tablet-01"
import IconHgTask01 from "~icons/hugeicons/task-01"
import IconHgTextAlignCenter from "~icons/hugeicons/text-align-center"
import IconHgTextAlignJustifyCenter from "~icons/hugeicons/text-align-justify-center"
import IconHgTextAlignLeft from "~icons/hugeicons/text-align-left"
import IconHgTextAlignRight from "~icons/hugeicons/text-align-right"
import IconHgTextFont from "~icons/hugeicons/text-font"
import IconHgTextItalic from "~icons/hugeicons/text-italic"
import IconHgTextStrikethrough from "~icons/hugeicons/text-strikethrough"
import IconHgTextSubscript from "~icons/hugeicons/text-subscript"
import IconHgTextSuperscript from "~icons/hugeicons/text-superscript"
import IconHgTextUnderline from "~icons/hugeicons/text-underline"
import IconHgTranslate from "~icons/hugeicons/translate"
import IconHgUnfoldMore from "~icons/hugeicons/unfold-more"
import IconHgUnlink01 from "~icons/hugeicons/unlink-01"
import IconHgUpload04 from "~icons/hugeicons/upload-04"
import IconHgUser from "~icons/hugeicons/user"
import IconHgUserAdd01 from "~icons/hugeicons/user-add-01"
import IconHgUserCircle from "~icons/hugeicons/user-circle"
import IconHgUserGroup from "~icons/hugeicons/user-group"
import IconHgUserMinus01 from "~icons/hugeicons/user-minus-01"
import IconHgUserMultiple from "~icons/hugeicons/user-multiple"
import IconHgUserMultiple02 from "~icons/hugeicons/user-multiple-02"
import IconHgUserSettings01 from "~icons/hugeicons/user-settings-01"
import IconHgVolumeHigh from "~icons/hugeicons/volume-high"
import IconHgWorkflowSquare01 from "~icons/hugeicons/workflow-square-01"
import IconHgWrench01 from "~icons/hugeicons/wrench-01"
import IconLogosAppleAppStore from "~icons/logos/apple-app-store"
import IconLogosDiscord from "~icons/logos/discord"
import IconLogosGithubIcon from "~icons/logos/github-icon"
import IconLogosGoogle from "~icons/logos/google"
import IconLogosGoogleCalendar from "~icons/logos/google-calendar"
import IconLogosGoogleDrive from "~icons/logos/google-drive"
import IconLogosGoogleGmail from "~icons/logos/google-gmail"
import IconLogosGoogleIcon from "~icons/logos/google-icon"
import IconLogosGooglePlayIcon from "~icons/logos/google-play-icon"
import IconLogosLinkedin from "~icons/logos/linkedin"
import IconLogosMeta from "~icons/logos/meta"
import IconLogosMicrosoftIcon from "~icons/logos/microsoft-icon"
import IconLogosMicrosoftWindows from "~icons/logos/microsoft-windows"
import IconLogosNetflix from "~icons/logos/netflix"
import IconLogosPinterest from "~icons/logos/pinterest"
import IconLogosReddit from "~icons/logos/reddit"
import IconLogosSlack from "~icons/logos/slack"
import IconLogosSpotify from "~icons/logos/spotify"
import IconLogosTwitter from "~icons/logos/twitter"
import IconLogosZoom from "~icons/logos/zoom"
import IconMaterialSymbolsCircle from "~icons/material-symbols/circle"
import IconMdiApple from "~icons/mdi/apple"
import IconMdiArrowRightCircle from "~icons/mdi/arrow-right-circle"
import IconMdiCircle from "~icons/mdi/circle"
import IconMdiCircleMedium from "~icons/mdi/circle-medium"
import IconMdiCircleSmall from "~icons/mdi/circle-small"
import IconMdiDotsCircle from "~icons/mdi/dots-circle"
import IconMdiFileCode from "~icons/mdi/file-code"
import IconMdiFileDelimited from "~icons/mdi/file-delimited"
import IconMdiFileDocument from "~icons/mdi/file-document"
import IconMdiFileExcelBox from "~icons/mdi/file-excel-box"
import IconMdiFileImage from "~icons/mdi/file-image"
import IconMdiFileMusic from "~icons/mdi/file-music"
import IconMdiFilePdfBox from "~icons/mdi/file-pdf-box"
import IconMdiFilePowerpointBox from "~icons/mdi/file-powerpoint-box"
import IconMdiFileQuestion from "~icons/mdi/file-question"
import IconMdiFileVideo from "~icons/mdi/file-video"
import IconMdiFileWordBox from "~icons/mdi/file-word-box"
import IconMdiFormatFont from "~icons/mdi/format-font"
import IconMdiFormatTextVariant from "~icons/mdi/format-text-variant"
import IconMdiGoogle from "~icons/mdi/google"
import IconMdiMicrosoft from "~icons/mdi/microsoft"
import IconMingcuteAiFill from "~icons/mingcute/ai-fill"
import IconMingcuteArrowRightUpCircleFill from "~icons/mingcute/arrow-right-up-circle-fill"
import IconMingcuteChat1Fill from "~icons/mingcute/chat-1-fill"
import IconMingcuteDownloadFill from "~icons/mingcute/download-fill"
import IconMingcuteGridFill from "~icons/mingcute/grid-fill"
import IconMingcuteLayerFill from "~icons/mingcute/layer-fill"
import IconMingcuteSignatureFill from "~icons/mingcute/signature-fill"
import IconRiFontMono from "~icons/ri/font-mono"
import IconRiFontSans from "~icons/ri/font-sans"
import IconRiFontSansSerif from "~icons/ri/font-sans-serif"
import IconRiSearchLine from "~icons/ri/search-line"
import IconRiZoomInLine from "~icons/ri/zoom-in-line"
import IconRiZoomOutLine from "~icons/ri/zoom-out-line"
import IconSimpleIconsAmazon from "~icons/simple-icons/amazon"
import IconSimpleIconsEbay from "~icons/simple-icons/ebay"
import IconSimpleIconsEtsy from "~icons/simple-icons/etsy"
import IconSimpleIconsFlathub from "~icons/simple-icons/flathub"
import IconSimpleIconsRakuten from "~icons/simple-icons/rakuten"
import IconSimpleIconsShopify from "~icons/simple-icons/shopify"
import IconTablerBrandWalmart from "~icons/tabler/brand-walmart"

/*
 * Hugeicons' lucide-named glyphs (the names our aliases are based on) ship only
 * in @hugeicons/core-free-icons as icon DATA, not in the iconify set that
 * unplugin-icons compiles (~icons/hugeicons/*). Bridge them through the
 * HugeiconsIcon renderer, replicating unplugin-icons' defaultClass and the
 * data-hg hook (stroke-weight CSS) from vite.config.ts so both pipelines
 * render identically.
 */
const hg =
  (icon: typeof GripHorizontalIcon): FunctionalComponent =>
  () =>
    h(HugeiconsIcon, {
      icon,
      class: "inline-flex shrink-0 size-4",
      "data-hg": "",
    })

const IconAperture = hg(ApertureIcon)
const IconArrowDownToLine = hg(ArrowDownToLineIcon)
const IconArrowLeftToLine = hg(ArrowLeftToLineIcon)
const IconArrowRightToLine = hg(ArrowRightToLineIcon)
const IconArrowUpToLine = hg(ArrowUpToLineIcon)
const IconAtSign = hg(AtSignIcon)
const IconBadgeCheck = hg(BadgeCheckIcon)
const IconBan = hg(BanIcon)
const IconBell = hg(BellIcon)
const IconBellRing = hg(BellRingIcon)
const IconBlocks = hg(BlocksIcon)
const IconBold = hg(BoldIcon)
const IconBolt = hg(BoltIcon)
const IconBot = hg(BotIcon)
const IconBotMessageSquare = hg(BotMessageSquareIcon)
const IconBox = hg(BoxIcon)
const IconBraces = hg(BracesIcon)
const IconCheck = hg(CheckIcon)
const IconCheckCheck = hg(CheckCheckIcon)
const IconChevronLeft = hg(ChevronLeftIcon)
const IconChevronRight = hg(ChevronRightIcon)
const IconChevronsDownUp = hg(ChevronsDownUpIcon)
const IconChevronsLeftRightEllipsis = hg(ChevronsLeftRightEllipsisIcon)
const IconChevronUp = hg(ChevronUpIcon)
const IconCircleCheck = hg(CircleCheckIcon)
const IconCircleCheckBig = hg(CircleCheckBigIcon)
const IconCircleDashed = hg(CircleDashedIcon)
const IconCircleDot = hg(CircleDotIcon)
const IconCircleDotDashed = hg(CircleDotDashedIcon)
const IconCirclePlus = hg(CirclePlusIcon)
const IconCircleX = hg(CircleXIcon)
const IconCloudCheck = hg(CloudCheckIcon)
const IconCloudRain = hg(CloudRainIcon)
const IconCloudSync = hg(CloudSyncIcon)
const IconCode = hg(CodeIcon)
const IconContrast = hg(ContrastIcon)
const IconDices = hg(DicesIcon)
const IconEllipsis = hg(EllipsisIcon)
const IconExternalLink = hg(ExternalLinkIcon)
const IconEye = hg(EyeIcon)
const IconEyeOff = hg(EyeOffIcon)
const IconFilePlus = hg(FilePlusIcon)
const IconGraduationCap = hg(GraduationCapIcon)
const IconGrid2X2 = hg(Grid2X2Icon)
const IconGrid2X2Plus = hg(Grid2X2PlusIcon)
const IconGripHorizontal = hg(GripHorizontalIcon)
const IconGripVertical = hg(GripVerticalIcon)
const IconHand = hg(HandIcon)
const IconHash = hg(HashIcon)
const IconHeart = hg(HeartIcon)
const IconHistory = hg(HistoryIcon)
const IconTable = hg(TableIcon)
const IconTerminal = hg(TerminalIcon)
const IconText = hg(TextIcon)
const IconZap = hg(ZapIcon)

/**
 * Icon Exports
 * Aggregates and re-exports icons from various icon sets (Hugeicons, MDI, etc.)
 * Used to provide a single source of truth for icons in the app
 */
export {
  IconHgActivity01 as IconActivity,
  IconHgAiChip as IconAiChip,
  IconMingcuteAiFill as IconAiFill,
  IconHgAlert02 as IconAlertTriangle,
  IconHgTextAlignCenter as IconAlignCenter,
  IconHgTextAlignJustifyCenter as IconAlignJustify,
  IconHgTextAlignLeft as IconAlignLeft,
  IconHgTextAlignRight as IconAlignRight,
  IconSimpleIconsAmazon as IconAmazon,
  IconAperture,
  IconBiApple as IconApple,
  IconLogosAppleAppStore as IconAppleAppStore,
  IconMdiApple as IconAppleFilled,
  IconMingcuteGridFill as IconApps,
  IconHgArchive as IconArchive,
  IconHgArrowUp02 as IconArrowBigUp,
  IconHgArrowDown02 as IconArrowDown,
  IconArrowDownToLine,
  IconHgArrowLeft02 as IconArrowLeft,
  IconArrowLeftToLine,
  IconHgArrowRight02 as IconArrowRight,
  IconMdiArrowRightCircle as IconArrowRightCircle,
  IconArrowRightToLine,
  IconMingcuteArrowRightUpCircleFill as IconArrowRightUpCircleFill,
  IconHgArrowUp02 as IconArrowUp,
  IconHgArrowUpDown as IconArrowUpDown,
  IconHgArrowUpRight01 as IconArrowUpRight,
  IconArrowUpToLine,
  IconHgAsterisk as IconAsterisk,
  IconAtSign,
  IconHgAudit01 as IconAudit,
  IconBadgeCheck,
  IconHgBadgeDollarSign as IconBadgeDollarSign,
  IconBan,
  IconBell,
  IconBellRing,
  IconBlocks,
  IconBold,
  IconBolt,
  IconHgBookOpen01 as IconBookOpen,
  IconHgBookmark02 as IconBookmark,
  IconHgBookmarkCheck01 as IconBookmarkCheck,
  IconBot,
  IconBotMessageSquare,
  IconBox,
  IconBraces,
  IconHgBrain as IconBrain,
  IconTablerBrandWalmart as IconBrandWalmart,
  IconHgBriefcase01 as IconBriefcase,
  IconHgBuilding06 as IconBuilding,
  IconBxBxsZap as IconBxsZap,
  IconHgCalculator01 as IconCalculator,
  IconHgCalendar01 as IconCalendar,
  IconHgCamera01 as IconCamera,
  IconHgCells as IconCells,
  IconMingcuteChat1Fill as IconChatFill,
  IconCheck,
  IconCheckCheck,
  IconHgCheckmarkCircle02 as IconCheckCircle,
  IconHgCheckmarkSquare02 as IconCheckSquare2,
  IconHgArrowDown01 as IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconChevronsDownUp,
  IconChevronsLeftRightEllipsis,
  IconHgUnfoldMore as IconChevronsUpDown,
  IconHgCircle as IconCircle,
  IconHgAlertCircle as IconCircleAlert,
  IconCircleCheck,
  IconCircleCheckBig,
  IconCircleDashed,
  IconCircleDot,
  IconCircleDotDashed,
  IconMdiCircle as IconCircleFilled,
  IconHgHelpCircle as IconCircleHelp,
  IconMdiCircleMedium as IconCircleMedium,
  IconHgPlayCircle as IconCirclePlay,
  IconCirclePlus,
  IconMdiCircleSmall as IconCircleSmall,
  IconMaterialSymbolsCircle as IconCircleSolid,
  IconHgUserCircle as IconCircleUser,
  IconHgUserCircle as IconCircleUserRound,
  IconCircleX,
  IconHgClock01 as IconClock,
  IconHgCloudAlert as IconCloudAlert,
  IconCloudCheck,
  IconCloudRain,
  IconCloudSync,
  IconCode,
  IconHgLayout2Column as IconColumns,
  IconHgCombine as IconCombine,
  IconHgCommand as IconCommand,
  IconHgComponent as IconComponent,
  IconHgCone01 as IconCone,
  IconContrast,
  IconHgCopy01 as IconCopy,
  IconHgCreditCard as IconCreditCard,
  IconHgDatabase01 as IconDatabase,
  IconDices,
  IconHgDisc as IconDisc,
  IconMdiDotsCircle as IconDotsCircle,
  IconHgDownload04 as IconDownload,
  IconMingcuteDownloadFill as IconDownloadFill,
  IconSimpleIconsEbay as IconEbay,
  IconEllipsis,
  IconSimpleIconsEtsy as IconEtsy,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconHgFile01 as IconFile,
  IconMdiFileCode as IconFileCode,
  IconMdiFileDelimited as IconFileDelimited,
  IconMdiFileDocument as IconFileDocument,
  IconMdiFileExcelBox as IconFileExcel,
  IconMdiFileImage as IconFileImage,
  IconMdiFileMusic as IconFileMusic,
  IconMdiFilePdfBox as IconFilePdf,
  IconFilePlus,
  IconMdiFilePowerpointBox as IconFilePowerPoint,
  IconMdiFileQuestion as IconFileQuestion,
  IconHgFile02 as IconFileText,
  IconMdiFileVideo as IconFileVideo,
  IconMdiFileWordBox as IconFileWord,
  IconSimpleIconsFlathub as IconFlathub,
  IconHgFolder01 as IconFolder,
  IconHgFolderOpen as IconFolderOpen,
  IconHgFolderAdd as IconFolderPlus,
  IconRiFontMono as IconFontMono,
  IconRiFontSans as IconFontSans,
  IconRiFontSansSerif as IconFontSansSerif,
  IconMdiFormatFont as IconFormatFont,
  IconHgArrowTurnForward as IconForward,
  IconHgGalleryHorizontalEnd as IconGalleryHorizontalEnd,
  IconHgGift as IconGift,
  IconHgGlobe as IconGlobe,
  IconMdiGoogle as IconGoogle,
  IconLogosGoogleIcon as IconGoogleIcon,
  IconLogosGooglePlayIcon as IconGooglePlayIcon,
  IconGraduationCap,
  IconGrid2X2,
  IconGrid2X2Plus,
  IconGripHorizontal,
  IconGripVertical,
  IconHgGroup as IconGroup,
  IconHand,
  IconHgHardDrive as IconHardDrive,
  IconHash,
  IconHgHeading01 as IconHeading1,
  IconHgHeading02 as IconHeading2,
  IconHgHeading03 as IconHeading3,
  IconHeart,
  IconHgHelpCircle as IconHelpCircle,
  IconHgHighlighter as IconHighlighter,
  IconHistory,
  IconHgHome01 as IconHome,
  IconHgHourglass as IconHourglass,
  IconHgImage01 as IconImage,
  IconHgInbox as IconInbox,
  IconHgInformationCircle as IconInfo,
  IconHgTextItalic as IconItalic,
  IconJapan,
  IconHgKey01 as IconKeyRound,
  IconHgKeyboard as IconKeyboard,
  IconHgTranslate as IconLanguages,
  IconHgLaptop as IconLaptop,
  IconMingcuteLayerFill as IconLayerFill,
  IconHgLayers01 as IconLayers,
  IconHgGridView as IconLayoutGrid,
  IconHgLeaf01 as IconLeaf,
  IconHgLifebuoy as IconLifeBuoy,
  IconHgLink01 as IconLink,
  IconHgLink02 as IconLink2,
  IconHgLeftToRightListBullet as IconList,
  IconHgCheckList as IconListChecks,
  IconHgTask01 as IconListCollapse,
  IconHgFilter as IconListFilter,
  IconHgLeftToRightListNumber as IconListOrdered,
  IconHgLoading03 as IconLoader2,
  IconHgLock as IconLock,
  IconHgLogout01 as IconLogOut,
  IconLogosDiscord,
  IconLogosGithubIcon,
  IconLogosGoogle,
  IconLogosGoogleCalendar,
  IconLogosGoogleDrive,
  IconLogosGoogleGmail,
  IconLogosLinkedin,
  IconLogosMeta,
  IconLogosMicrosoftWindows,
  IconLogosNetflix,
  IconLogosPinterest,
  IconLogosReddit,
  IconLogosSlack,
  IconLogosSpotify,
  IconLogosTwitter,
  IconLogosZoom,
  IconHgLeftToRightListDash as IconLogs,
  IconHgMail01 as IconMail,
  IconHgMapPin as IconMapPin,
  IconHgMaximize01 as IconMaximize,
  IconMdiFormatTextVariant,
  IconHgMenu01 as IconMenu,
  IconHgBubbleChat as IconMessageCircle,
  IconHgComment01 as IconMessageCircleMore,
  IconHgMessageMultiple01 as IconMessagesSquare,
  IconHgMic01 as IconMic,
  IconMdiMicrosoft as IconMicrosoft,
  IconLogosMicrosoftIcon as IconMicrosoftIcon,
  IconHgMinimize01 as IconMinimize,
  IconHgMinusSign as IconMinus,
  IconHgRemoveCircle as IconMinusCircle,
  IconHgRemoveSquare as IconMinusSquare,
  IconHgComputer as IconMonitor,
  IconHgMoon02 as IconMoon,
  IconHgMoreHorizontal as IconMoreHorizontal,
  IconHgMoreVertical as IconMoreVertical,
  IconHgPaintBoard as IconPalette,
  IconHgLayoutBottom as IconPanelBottom,
  IconHgPanelBottomClose as IconPanelBottomClose,
  IconHgPanelLeft as IconPanelLeft,
  IconHgPanelLeftClose as IconPanelLeftClose,
  IconHgPanelRight as IconPanelRight,
  IconHgPanelRightClose as IconPanelRightClose,
  IconHgPause as IconPause,
  IconHgPauseCircle as IconPauseCircle,
  IconHgEdit01 as IconPenLine,
  IconHgPencilEdit02 as IconPencil,
  IconHgPencilRuler as IconPencilRuler,
  IconHgPictureInPictureOn as IconPictureInPicture,
  IconHgPictureInPictureExit as IconPictureInPicture2,
  IconHgPin as IconPin,
  IconHgPinOff as IconPinOff,
  IconHgPlay as IconPlay,
  IconHgPlug01 as IconPlug,
  IconHgAdd01 as IconPlus,
  IconHgAddSquare as IconPlusSquare,
  IconHgCursorPointer01 as IconPointerClick,
  IconHgQuoteUp as IconQuote,
  IconSimpleIconsRakuten as IconRakuten,
  IconHgArrowReloadHorizontal as IconRefreshCcw,
  IconHgRefresh as IconRefreshCw,
  IconHgRepeat as IconRepeat,
  IconHgArrowTurnBackward as IconReply,
  IconHgRocket01 as IconRocket,
  IconHgRotateLeft01 as IconRotateCcw,
  IconHgLayout2Row as IconRows,
  IconHgScroll as IconScroll,
  IconHgSearch01 as IconSearch,
  IconRiSearchLine as IconSearchLine,
  IconHgSent as IconSend,
  IconHgSettings01 as IconSettings,
  IconHgSettings02 as IconSettings2,
  IconHgShield01 as IconShieldCheck,
  IconSimpleIconsShopify as IconShopify,
  IconHgFullSignal as IconSignalHigh,
  IconHgLowSignal as IconSignalLow,
  IconHgMediumSignal as IconSignalMedium,
  IconMingcuteSignatureFill as IconSignatureFill,
  IconHgSmartPhone01 as IconSmartphone,
  IconHgSmile as IconSmile,
  IconHgSparkles as IconSparkle,
  IconHgSparkles as IconSparkles,
  IconHgSplit as IconSplit,
  IconHgTableColumnsSplit as IconSplitSquareHorizontal,
  IconHgSquare as IconSquare,
  IconHgSquareArrowUpRight as IconSquareArrowOutUpRight,
  IconHgSquare as IconSquareDashed,
  IconHgCursorMagicSelection01 as IconSquareDashedMousePointer,
  IconHgSquareMousePointer as IconSquareMousePointer,
  IconHgEdit02 as IconSquarePen,
  IconHgCancelSquare as IconSquareX,
  IconHgStar as IconStar,
  IconHgStarOff as IconStarOff,
  IconHgTextStrikethrough as IconStrikethrough,
  IconHgTextSubscript as IconSubscript,
  IconHgSun02 as IconSun,
  IconHgMoonEclipse as IconSunMoon,
  IconHgTextSuperscript as IconSuperscript,
  IconHgArrowLeftRight as IconSwitchHorizontal,
  IconTable,
  IconHgTablet01 as IconTablet,
  IconTerminal,
  IconText,
  IconHgDelete02 as IconTrash,
  IconHgDelete03 as IconTrash2,
  IconHgAlert02 as IconTriangleAlert,
  IconHgTextFont as IconType,
  IconUSA,
  IconHgTextUnderline as IconUnderline,
  IconHgUnlink01 as IconUnlink,
  IconHgUpload04 as IconUpload,
  IconHgUserSettings01 as IconUserCog,
  IconHgUser as IconUserRound,
  IconHgUserMinus01 as IconUserRoundMinus,
  IconHgUserAdd01 as IconUserRoundPlus,
  IconHgUserMultiple as IconUsers,
  IconHgUserMultiple02 as IconUsers2,
  IconHgUserGroup as IconUsersRound,
  IconHgVolumeHigh as IconVolume2,
  IconHgWorkflowSquare01 as IconWorkflow,
  IconHgWrench01 as IconWrench,
  IconHgCancel01 as IconX,
  IconHgCancelCircle as IconXCircle,
  IconHgCancelSquare as IconXSquare,
  IconZap,
  IconRiZoomInLine as IconZoomIn,
  IconRiZoomOutLine as IconZoomOut,
}
