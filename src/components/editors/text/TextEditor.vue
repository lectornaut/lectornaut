<script lang="ts" setup>
import content from "@/data/content.json"
import {
  IconAlignCenter,
  IconAlignJustify,
  IconAlignLeft,
  IconAlignRight,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconBold,
  IconBraces,
  IconCheck,
  IconCircleFilled,
  IconCode,
  IconColumns,
  IconCombine,
  IconCopy,
  IconExternalLink,
  IconGripVertical,
  IconHeading1,
  IconHeading2,
  IconHeading3,
  IconHighlighter,
  IconItalic,
  IconLink,
  IconList,
  IconListChecks,
  IconListCollapse,
  IconListOrdered,
  IconPalette,
  IconPlus,
  IconQuote,
  IconRefreshCcw,
  IconRows,
  IconSettings,
  IconSplit,
  IconSplitSquareHorizontal,
  IconSquare,
  IconStrikethrough,
  IconSubscript,
  IconSuperscript,
  IconTable,
  IconText,
  IconTrash,
  IconType,
  IconUnderline,
  IconUnlink,
  IconWrench,
  IconX,
} from "@/data/icons"
import { accents, fonts, sizes } from "@/helpers/defaults"
import type { JSONContent } from "@tiptap/core"
import Blockquote from "@tiptap/extension-blockquote"
import Bold from "@tiptap/extension-bold"
import Code from "@tiptap/extension-code"
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight"
import {
  Details,
  DetailsContent,
  DetailsSummary,
} from "@tiptap/extension-details"
import Document from "@tiptap/extension-document"
import { DragHandle } from "@tiptap/extension-drag-handle-vue-3"
import Emoji from "@tiptap/extension-emoji"
import FileHandler from "@tiptap/extension-file-handler"
import HardBreak from "@tiptap/extension-hard-break"
import Heading from "@tiptap/extension-heading"
import Highlight from "@tiptap/extension-highlight"
import HorizontalRule from "@tiptap/extension-horizontal-rule"
import Image from "@tiptap/extension-image"
import InvisibleCharacters from "@tiptap/extension-invisible-characters"
import Italic from "@tiptap/extension-italic"
import Link from "@tiptap/extension-link"
import { BulletList } from "@tiptap/extension-list/bullet-list"
import { ListItem } from "@tiptap/extension-list/item"
import { ListKeymap } from "@tiptap/extension-list/keymap"
import { OrderedList } from "@tiptap/extension-list/ordered-list"
import { TaskItem } from "@tiptap/extension-list/task-item"
import { TaskList } from "@tiptap/extension-list/task-list"
import { Mathematics, migrateMathStrings } from "@tiptap/extension-mathematics"
import Paragraph from "@tiptap/extension-paragraph"
import Strike from "@tiptap/extension-strike"
import Subscript from "@tiptap/extension-subscript"
import Superscript from "@tiptap/extension-superscript"
import { TableCell } from "@tiptap/extension-table/cell"
import { TableHeader } from "@tiptap/extension-table/header"
import { TableRow } from "@tiptap/extension-table/row"
import { Table } from "@tiptap/extension-table/table"
import Text from "@tiptap/extension-text"
import TextAlign from "@tiptap/extension-text-align"
import { TextStyle } from "@tiptap/extension-text-style"
import { BackgroundColor } from "@tiptap/extension-text-style/background-color"
import { Color } from "@tiptap/extension-text-style/color"
import { FontFamily } from "@tiptap/extension-text-style/font-family"
import { FontSize } from "@tiptap/extension-text-style/font-size"
import { LineHeight } from "@tiptap/extension-text-style/line-height"
import Typography from "@tiptap/extension-typography"
import Underline from "@tiptap/extension-underline"
import UniqueID from "@tiptap/extension-unique-id"
import { CharacterCount } from "@tiptap/extensions/character-count"
import { Dropcursor } from "@tiptap/extensions/drop-cursor"
import { Focus } from "@tiptap/extensions/focus"
import { Gapcursor } from "@tiptap/extensions/gap-cursor"
import { Placeholder } from "@tiptap/extensions/placeholder"
import { Selection } from "@tiptap/extensions/selection"
import { TrailingNode } from "@tiptap/extensions/trailing-node"
import { UndoRedo } from "@tiptap/extensions/undo-redo"
import { EditorContent, useEditor } from "@tiptap/vue-3"
import { BubbleMenu, FloatingMenu } from "@tiptap/vue-3/menus"
import { common, createLowlight } from "lowlight"

const readOnly = ref(false)

const json = ref<JSONContent | null>(null)

const editor = useEditor({
  editable: !readOnly.value,
  content: content,
  editorProps: {
    attributes: {
      class:
        "focus:outline-none size-full pl-10 pr-2 py-2 prose prose-sm max-w-none prose-neutral dark:prose-invert",
    },
  },
  extensions: [
    Document,
    Paragraph,
    Text,
    Blockquote,
    BulletList,
    OrderedList,
    TaskList,
    ListItem,
    TaskItem.configure({
      nested: true,
    }),
    ListKeymap,
    CodeBlockLowlight.configure({
      lowlight: createLowlight(common),
    }),
    Details.configure({
      persist: true,
    }),
    DetailsSummary,
    DetailsContent,
    Placeholder.configure({
      includeChildren: true,
      placeholder: ({ node }) => {
        if (node.type.name === "detailsSummary") {
          return "Summary"
        }
        return "Type '/' for commands"
      },
    }),
    Selection,
    TrailingNode,
    Emoji.configure({
      enableEmoticons: true,
    }),
    HardBreak,
    Heading.configure({
      levels: [1, 2, 3],
    }),
    TextAlign.configure({
      types: ["heading", "paragraph"],
    }),
    HorizontalRule,
    Image,
    Dropcursor,
    Gapcursor,
    Bold,
    Italic,
    Underline,
    Code,
    Highlight.configure({ multicolor: true }),
    Link.configure({
      openOnClick: false,
      defaultProtocol: "https",
    }),
    Strike,
    Subscript,
    Superscript,
    TextStyle,
    Color,
    BackgroundColor,
    Table.configure({
      resizable: true,
      allowTableNodeSelection: true,
    }),
    TableRow,
    TableHeader,
    TableCell,
    CharacterCount,
    Typography,
    UndoRedo,
    Focus,
    FileHandler.configure({
      allowedMimeTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
      onDrop: (currentEditor, files, pos) => {
        files.forEach((file) => {
          const fileReader = new FileReader()

          fileReader.readAsDataURL(file)
          fileReader.onload = () => {
            currentEditor
              .chain()
              .insertContentAt(pos, {
                type: "image",
                attrs: {
                  src: fileReader.result,
                },
              })
              .focus()
              .run()
          }
        })
      },
      onPaste: (currentEditor, files) => {
        files.forEach((file) => {
          const fileReader = new FileReader()

          fileReader.readAsDataURL(file)
          fileReader.onload = () => {
            currentEditor
              .chain()
              .insertContentAt(currentEditor?.state.selection.anchor, {
                type: "image",
                attrs: {
                  src: fileReader.result,
                },
              })
              .focus()
              .run()
          }
        })
      },
    }),
    FontFamily,
    FontSize,
    LineHeight,
    InvisibleCharacters.configure({
      visible: false, // Hide invisible characters by default
    }),
    Mathematics.configure({
      inlineOptions: {
        // optional options for the inline math node
      },
      blockOptions: {
        // optional options for the block math node
      },
      katexOptions: {
        // optional options for the KaTeX renderer
      },
    }),
    UniqueID.configure({
      types: ["heading", "paragraph"],
    }),
  ],
  onCreate: ({ editor: currentEditor }) => {
    migrateMathStrings(currentEditor)
    json.value = currentEditor.getJSON()
  },
  onUpdate: ({ editor: currentEditor }) => {
    json.value = currentEditor.getJSON()
  },
})

watch(readOnly, (newValue) => {
  editor.value?.setEditable(!newValue)
})

onBeforeUnmount(() => {
  editor.value?.destroy()
})

const source = ref(JSON.stringify(json.value, null, 2))

watch(json, (newValue) => {
  source.value = JSON.stringify(newValue, null, 2)
})

const { copy, copied } = useClipboard({ source, legacy: true })
</script>

<template>
  <OverlayScrollbarsWrapper>
    <EditorContent :editor="editor" />
    <BubbleMenu v-if="editor" :editor="editor">
      <div class="bg-card flex rounded-lg border p-1 shadow-lg">
        <TooltipProvider>
          <ButtonGroup>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger as-child>
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="data-[state=open]:bg-accent"
                    >
                      <IconRefreshCcw />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Turn Into</TooltipContent>
                <DropdownMenuContent class="w-48" align="start">
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    Turn into
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().setParagraph().run()"
                    >
                      <IconType /> Paragraph
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('paragraph')"
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="
                        editor
                          ?.chain()
                          .focus()
                          .toggleHeading({ level: 1 })
                          .run()
                      "
                    >
                      <IconHeading1 /> Heading 1
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('heading', { level: 1 })"
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="
                        editor
                          ?.chain()
                          .focus()
                          .toggleHeading({ level: 2 })
                          .run()
                      "
                    >
                      <IconHeading2 /> Heading 2
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('heading', { level: 2 })"
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="
                        editor
                          ?.chain()
                          .focus()
                          .toggleHeading({ level: 3 })
                          .run()
                      "
                    >
                      <IconHeading3 /> Heading 3
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('heading', { level: 3 })"
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().toggleBulletList().run()"
                    >
                      <IconList /> Bulleted list
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('bulletList')"
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().toggleOrderedList().run()"
                    >
                      <IconListOrdered /> Numbered list
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('orderedList')"
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().toggleTaskList().run()"
                    >
                      <IconListChecks /> To-do list
                      <DropdownMenuShortcut v-if="editor?.isActive('taskList')">
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().setDetails().run()"
                    >
                      <IconListCollapse /> Toggle list
                      <DropdownMenuShortcut v-if="editor?.isActive('details')">
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().toggleCodeBlock().run()"
                    >
                      <IconCode /> Code block
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('codeBlock')"
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().toggleBlockquote().run()"
                    >
                      <IconQuote /> Blockquote
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('blockquote')"
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
          </ButtonGroup>

          <Tooltip>
            <TooltipTrigger as-child>
              <Toggle
                :value="'bold'"
                :pressed="editor?.isActive('bold')"
                @click="editor?.chain().focus().toggleBold().run()"
              >
                <IconBold />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Bold</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Toggle
                :value="'italic'"
                :pressed="editor?.isActive('italic')"
                @click="editor?.chain().focus().toggleItalic().run()"
              >
                <IconItalic />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Italic</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Toggle
                :value="'underline'"
                :pressed="editor?.isActive('underline')"
                @click="editor?.chain().focus().toggleUnderline().run()"
              >
                <IconUnderline />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Underline</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Toggle
                :value="'strike'"
                :pressed="editor?.isActive('strike')"
                @click="editor?.chain().focus().toggleStrike().run()"
              >
                <IconStrikethrough />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Strike</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Toggle
                :value="'code'"
                :pressed="editor?.isActive('code')"
                @click="editor?.chain().focus().toggleCode().run()"
              >
                <IconBraces />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Code</TooltipContent>
          </Tooltip>

          <ButtonGroup>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger as-child>
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="data-[state=open]:bg-accent"
                    >
                      <IconPalette />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Text Color</TooltipContent>
                <DropdownMenuContent class="w-48">
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    Text Color
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      v-for="color in accents"
                      :key="color.id"
                      @click="editor?.chain().focus().setColor(color.id).run()"
                    >
                      <IconCircleFilled :class="`text-${color.id}-500`" />
                      {{ color.name }}
                      <DropdownMenuShortcut
                        v-if="
                          editor?.isActive('textStyle', { color: color.id })
                        "
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    @click="editor?.chain().focus().unsetColor().run()"
                  >
                    <IconX /> Remove Color
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger as-child>
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="data-[state=open]:bg-accent"
                    >
                      <IconHighlighter />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Highlight Color</TooltipContent>
                <DropdownMenuContent class="w-48">
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    Highlight Color
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      v-for="color in accents"
                      :key="color.id"
                      @click="
                        editor
                          ?.chain()
                          .focus()
                          .toggleHighlight({ color: color.id })
                          .run()
                      "
                    >
                      <IconCircleFilled :class="`text-${color.id}-500`" />
                      {{ color.name }}
                      <DropdownMenuShortcut
                        v-if="
                          editor?.isActive('highlight', { color: color.id })
                        "
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    @click="editor?.chain().focus().unsetHighlight().run()"
                  >
                    <IconX /> Remove Highlight
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
          </ButtonGroup>

          <ButtonGroup>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger as-child>
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="data-[state=open]:bg-accent"
                    >
                      <IconType />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Font Size</TooltipContent>
                <DropdownMenuContent class="w-48">
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    Font Size
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      v-for="size in sizes"
                      :key="size.id"
                      @click="
                        editor?.chain().focus().setFontSize(size.id).run()
                      "
                    >
                      <span class="mr-2" :style="{ fontSize: size.id }"
                        >Aa</span
                      >
                      {{ size.name }}
                      <DropdownMenuShortcut
                        v-if="
                          editor?.isActive('textStyle', { fontSize: size.id })
                        "
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    @click="editor?.chain().focus().unsetFontSize().run()"
                  >
                    <IconX /> Remove Font Size
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger as-child>
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="data-[state=open]:bg-accent"
                    >
                      <IconText />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Font Family</TooltipContent>
                <DropdownMenuContent class="w-48">
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    Font Family
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      v-for="font in fonts"
                      :key="font.id"
                      @click="
                        editor?.chain().focus().setFontFamily(font.id).run()
                      "
                    >
                      <span class="mr-2" :style="{ fontFamily: font.id }"
                        >Aa</span
                      >
                      {{ font.name }}
                      <DropdownMenuShortcut
                        v-if="
                          editor?.isActive('textStyle', {
                            fontFamily: font.id,
                          })
                        "
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="
                        editor
                          ?.chain()
                          .focus()
                          .setFontFamily('Comic Sans MS, Comic Sans')
                          .run()
                      "
                    >
                      <span
                        class="mr-2"
                        :style="{ fontFamily: 'Comic Sans MS' }"
                        >Aa</span
                      >
                      Comic Sans
                      <DropdownMenuShortcut
                        v-if="
                          editor?.isActive('textStyle', {
                            fontFamily: 'Comic Sans MS, Comic Sans',
                          })
                        "
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="
                        editor?.chain().focus().setFontFamily('cursive').run()
                      "
                    >
                      <span class="mr-2" style="font-family: cursive">Aa</span>
                      Cursive
                      <DropdownMenuShortcut
                        v-if="
                          editor?.isActive('textStyle', {
                            fontFamily: 'cursive',
                          })
                        "
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    @click="editor?.chain().focus().unsetFontFamily().run()"
                  >
                    <IconX /> Remove Font Family
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger as-child>
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="data-[state=open]:bg-accent"
                    >
                      <IconAlignLeft />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Text Align</TooltipContent>
                <DropdownMenuContent class="w-48">
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    Text Alignment
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      @click="
                        editor?.chain().focus().setTextAlign('left').run()
                      "
                    >
                      <IconAlignLeft /> Left
                      <DropdownMenuShortcut
                        v-if="editor?.isActive({ textAlign: 'left' })"
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="
                        editor?.chain().focus().setTextAlign('center').run()
                      "
                    >
                      <IconAlignCenter /> Center
                      <DropdownMenuShortcut
                        v-if="editor?.isActive({ textAlign: 'center' })"
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="
                        editor?.chain().focus().setTextAlign('right').run()
                      "
                    >
                      <IconAlignRight /> Right
                      <DropdownMenuShortcut
                        v-if="editor?.isActive({ textAlign: 'right' })"
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="
                        editor?.chain().focus().setTextAlign('justify').run()
                      "
                    >
                      <IconAlignJustify /> Justify
                      <DropdownMenuShortcut
                        v-if="editor?.isActive({ textAlign: 'justify' })"
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    Text Style
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().toggleSubscript().run()"
                    >
                      <IconSubscript /> Subscript
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('subscript')"
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().toggleSuperscript().run()"
                    >
                      <IconSuperscript /> Superscript
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('superscript')"
                      >
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    @click="editor?.chain().focus().unsetTextAlign().run()"
                  >
                    <IconX /> Remove Alignment
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
          </ButtonGroup>

          <ButtonGroup>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger as-child>
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="data-[state=open]:bg-accent"
                    >
                      <IconTable />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Table</TooltipContent>
                <DropdownMenuContent class="w-48">
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    Table
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      @click="
                        editor
                          ?.chain()
                          .focus()
                          .insertTable({
                            rows: 3,
                            cols: 3,
                            withHeaderRow: true,
                          })
                          .run()
                      "
                    >
                      <IconPlus /> Insert Table
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().deleteTable().run()"
                    >
                      <IconTrash /> Delete Table
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    Columns
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().addColumnBefore().run()"
                    >
                      <IconArrowLeft /> Add Column Before
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().addColumnAfter().run()"
                    >
                      <IconArrowRight /> Add Column After
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().deleteColumn().run()"
                    >
                      <IconTrash /> Delete Column
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    Rows
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().addRowBefore().run()"
                    >
                      <IconArrowUp /> Add Row Before
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().addRowAfter().run()"
                    >
                      <IconArrowDown /> Add Row After
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().deleteRow().run()"
                    >
                      <IconTrash /> Delete Row
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    Cells
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().mergeCells().run()"
                    >
                      <IconCombine /> Merge Cells
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().splitCell().run()"
                    >
                      <IconSplit /> Split Cell
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().mergeOrSplit().run()"
                    >
                      <IconSplitSquareHorizontal /> Merge or Split
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    Headers
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      @click="
                        editor?.chain().focus().toggleHeaderColumn().run()
                      "
                    >
                      <IconColumns /> Toggle Header Column
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().toggleHeaderRow().run()"
                    >
                      <IconRows /> Toggle Header Row
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().toggleHeaderCell().run()"
                    >
                      <IconSquare /> Toggle Header Cell
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    Navigation
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().goToNextCell().run()"
                    >
                      <IconArrowRight /> Go to Next Cell
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().goToPreviousCell().run()"
                    >
                      <IconArrowLeft /> Go to Previous Cell
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    Advanced
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      @click="
                        editor
                          ?.chain()
                          .focus()
                          .setCellAttribute('colspan', 2)
                          .run()
                      "
                    >
                      <IconSettings /> Set Cell Attribute
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().fixTables().run()"
                    >
                      <IconWrench /> Fix Tables
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
          </ButtonGroup>

          <ButtonGroup>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger as-child>
                  <DropdownMenuTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="data-[state=open]:bg-accent"
                    >
                      <IconLink />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Link</TooltipContent>
                <DropdownMenuContent class="w-48" align="end">
                  <DropdownMenuLabel class="text-muted-foreground text-xs">
                    Link Management
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      @click="
                        editor
                          ?.chain()
                          .focus()
                          .toggleLink({ href: 'https://example.com' })
                          .run()
                      "
                    >
                      <IconLink /> Toggle Link
                      <DropdownMenuShortcut v-if="editor?.isActive('link')">
                        <IconCheck />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="
                        editor?.getAttributes('link').href !== null
                          ? editor?.getAttributes('link').href === ''
                            ? editor
                                ?.chain()
                                .focus()
                                .extendMarkRange('link')
                                .unsetLink()
                                .run()
                            : editor
                                ?.chain()
                                .focus()
                                .extendMarkRange('link')
                                .setLink({ href: 'https://example.com' })
                                .run()
                          : editor
                              ?.chain()
                              .focus()
                              .extendMarkRange('link')
                              .setLink({ href: 'https://example.com' })
                              .run()
                      "
                    >
                      <IconExternalLink /> Set Link
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      :disabled="!editor?.isActive('link')"
                      @click="editor?.chain().focus().unsetLink().run()"
                    >
                      <IconUnlink /> Remove Link
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
          </ButtonGroup>
        </TooltipProvider>
      </div>
    </BubbleMenu>
    <FloatingMenu
      v-if="editor"
      :editor="editor"
      :tippy-options="{ duration: 100 }"
    >
      <div
        class="bg-card flex items-center gap-1 rounded-lg border p-1 shadow-lg"
      >
        <Button
          variant="ghost"
          size="icon"
          :class="{ 'bg-accent': editor?.isActive('heading', { level: 1 }) }"
          @click="editor?.chain().focus().toggleHeading({ level: 1 }).run()"
        >
          <IconHeading1 />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          :class="{ 'bg-accent': editor?.isActive('heading', { level: 2 }) }"
          @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()"
        >
          <IconHeading2 />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          :class="{ 'bg-accent': editor?.isActive('bulletList') }"
          @click="editor?.chain().focus().toggleBulletList().run()"
        >
          <IconList />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          :class="{ 'bg-accent': editor?.isActive('orderedList') }"
          @click="editor?.chain().focus().toggleOrderedList().run()"
        >
          <IconListOrdered />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          :class="{ 'bg-accent': editor?.isActive('taskList') }"
          @click="editor?.chain().focus().toggleTaskList().run()"
        >
          <IconListChecks />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          :class="{ 'bg-accent': editor?.isActive('codeBlock') }"
          @click="editor?.chain().focus().toggleCodeBlock().run()"
        >
          <IconCode />
        </Button>
      </div>
    </FloatingMenu>
    <DragHandle v-if="editor" :editor="editor">
      <Button variant="ghost" size="icon-sm" class="mr-2 size-6">
        <IconGripVertical />
      </Button>
    </DragHandle>
    <Teleport defer to="#cta-dock">
      <div class="text-muted-foreground flex items-center gap-2 text-xs">
        {{ editor?.storage.characterCount.characters() }} characters /
        {{ editor?.storage.characterCount.words() }} words /
        {{ Math.ceil((editor?.storage.characterCount.words() || 0) / 200) }} min
        read
        <div class="flex items-center gap-2">
          <Checkbox id="readOnly" v-model="readOnly" />
          <Label for="readOnly" class="text-xs">Read-only</Label>
        </div>
        <Button variant="ghost" size="icon" @click="copy(source)">
          <IconCopy v-if="!copied" />
          <IconCheck v-else />
        </Button>
      </div>
    </Teleport>
  </OverlayScrollbarsWrapper>
</template>

<style lang="scss">
/* Basic editor styles */
.tiptap {
  :first-child {
    margin-top: 0;
  }

  /* List styles */
  ul,
  ol {
    padding: 0 1rem;
    margin: 1.25rem 1rem 1.25rem 0.4rem;

    li p {
      margin-top: 0.25em;
      margin-bottom: 0.25em;
    }
  }

  /* Task list specific styles */
  [data-type="taskList"] {
    list-style: none;
    margin-left: 0;
    padding: 0;

    li {
      align-items: center;
      display: flex;

      > label {
        flex: 0 0 auto;
        margin-right: 0.5rem;
        user-select: none;
      }

      > div {
        flex: 1 1 auto;
      }
    }

    input[type="checkbox"] {
      cursor: pointer;
      accent-color: inherit;
    }
  }

  /* Details */
  [data-type="details"] {
    list-style: none;
    display: flex;
    gap: 0.25rem;
    margin: 1.5rem 0;
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    padding: 0.5rem;

    summary {
      font-weight: 700;
    }

    > button {
      align-items: center;
      background: transparent;
      border-radius: 4px;
      display: flex;
      font-size: 0.625rem;
      height: 1.25rem;
      justify-content: center;
      line-height: 1;
      margin-top: 0.1rem;
      padding: 0;
      width: 1.25rem;

      &:hover {
        background-color: var(--color-border);
      }

      &::before {
        content: "\25B6";
      }
    }

    &.is-open > button::before {
      transform: rotate(90deg);
    }

    > div {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      width: 100%;

      > [data-type="detailsContent"] > :last-child {
        margin-bottom: 0.5rem;
      }
    }

    .details {
      margin: 0.5rem 0;
    }
  }

  /* Editable */
  &[contenteditable="false"] {
    color: #999;
    opacity: 0.6;
  }
}
</style>
