<script lang="ts" setup>
import content from "@/data/content.json"
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
import { BubbleMenu } from "@tiptap/vue-3/menus"
import { common, createLowlight } from "lowlight"

const editable = ref(true)

const json = ref<JSONContent | null>(null)

const editor = useEditor({
  editable: editable.value,
  content: content,
  editorProps: {
    attributes: {
      class:
        "focus:outline-none size-full pl-10 pr-2 py-2 prose prose-sm max-w-none dark:prose-invert prose-stone dark:prose-zinc",
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

watch(editable, (newValue) => {
  editor.value?.setEditable(newValue)
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
                  <DropdownMenuTrigger>
                    <Button variant="ghost" size="icon">
                      <icon-lucide-refresh-ccw />
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
                      <icon-lucide-type /> Paragraph
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('paragraph')"
                      >
                        <icon-lucide-check />
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
                      <icon-lucide-heading-1 /> Heading 1
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('heading', { level: 1 })"
                      >
                        <icon-lucide-check />
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
                      <icon-lucide-heading-2 /> Heading 2
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('heading', { level: 2 })"
                      >
                        <icon-lucide-check />
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
                      <icon-lucide-heading-3 /> Heading 3
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('heading', { level: 3 })"
                      >
                        <icon-lucide-check />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().toggleBulletList().run()"
                    >
                      <icon-lucide-list /> Bulleted list
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('bulletList')"
                      >
                        <icon-lucide-check />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().toggleOrderedList().run()"
                    >
                      <icon-lucide-list-ordered /> Numbered list
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('orderedList')"
                      >
                        <icon-lucide-check />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().toggleTaskList().run()"
                    >
                      <icon-lucide-list-checks /> To-do list
                      <DropdownMenuShortcut v-if="editor?.isActive('taskList')">
                        <icon-lucide-check />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().setDetails().run()"
                    >
                      <icon-lucide-list-collapse /> Toggle list
                      <DropdownMenuShortcut v-if="editor?.isActive('details')">
                        <icon-lucide-check />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().toggleCodeBlock().run()"
                    >
                      <icon-lucide-code /> Code block
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('codeBlock')"
                      >
                        <icon-lucide-check />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().toggleBlockquote().run()"
                    >
                      <icon-lucide-quote /> Blockquote
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('blockquote')"
                      >
                        <icon-lucide-check />
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
                <icon-lucide-bold />
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
                <icon-lucide-italic />
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
                <icon-lucide-underline />
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
                <icon-lucide-strikethrough />
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
                <icon-lucide-braces />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>Code</TooltipContent>
          </Tooltip>

          <ButtonGroup>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger as-child>
                  <DropdownMenuTrigger>
                    <Button variant="ghost" size="icon">
                      <icon-lucide-palette />
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
                      v-for="accent in accents"
                      :key="accent.id"
                      @click="editor?.chain().focus().setColor(accent.id).run()"
                    >
                      <div
                        class="mr-2 h-4 w-4 rounded-full"
                        :style="{ backgroundColor: accent.id }"
                      ></div>
                      {{ accent.name }}
                      <DropdownMenuShortcut
                        v-if="
                          editor?.isActive('textStyle', { color: accent.id })
                        "
                      >
                        <icon-lucide-check />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    @click="editor?.chain().focus().unsetColor().run()"
                  >
                    <icon-lucide-x /> Remove Color
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger as-child>
                  <DropdownMenuTrigger>
                    <Button variant="ghost" size="icon">
                      <icon-lucide-highlighter />
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
                      @click="editor?.chain().focus().toggleHighlight().run()"
                    >
                      <div
                        class="mr-2 h-4 w-4 rounded-full bg-yellow-300"
                      ></div>
                      Default
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('highlight')"
                      >
                        <icon-lucide-check />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      v-for="accent in accents"
                      :key="accent.id"
                      @click="
                        editor
                          ?.chain()
                          .focus()
                          .toggleHighlight({ color: accent.id })
                          .run()
                      "
                    >
                      <div
                        class="mr-2 h-4 w-4 rounded-full opacity-50"
                        :style="{ backgroundColor: accent.id }"
                      ></div>
                      {{ accent.name }}
                      <DropdownMenuShortcut
                        v-if="
                          editor?.isActive('highlight', { color: accent.id })
                        "
                      >
                        <icon-lucide-check />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    @click="editor?.chain().focus().unsetHighlight().run()"
                  >
                    <icon-lucide-x /> Remove Highlight
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
          </ButtonGroup>

          <ButtonGroup>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger as-child>
                  <DropdownMenuTrigger>
                    <Button variant="ghost" size="icon">
                      <icon-lucide-type />
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
                        <icon-lucide-check />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    @click="editor?.chain().focus().unsetFontSize().run()"
                  >
                    <icon-lucide-x /> Remove Font Size
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger as-child>
                  <DropdownMenuTrigger>
                    <Button variant="ghost" size="icon">
                      <icon-lucide-text />
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
                        <icon-lucide-check />
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
                        <icon-lucide-check />
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
                        <icon-lucide-check />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    @click="editor?.chain().focus().unsetFontFamily().run()"
                  >
                    <icon-lucide-x /> Remove Font Family
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger as-child>
                  <DropdownMenuTrigger>
                    <Button variant="ghost" size="icon">
                      <icon-lucide-align-left />
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
                      <icon-lucide-align-left /> Left
                      <DropdownMenuShortcut
                        v-if="editor?.isActive({ textAlign: 'left' })"
                      >
                        <icon-lucide-check />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="
                        editor?.chain().focus().setTextAlign('center').run()
                      "
                    >
                      <icon-lucide-align-center /> Center
                      <DropdownMenuShortcut
                        v-if="editor?.isActive({ textAlign: 'center' })"
                      >
                        <icon-lucide-check />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="
                        editor?.chain().focus().setTextAlign('right').run()
                      "
                    >
                      <icon-lucide-align-right /> Right
                      <DropdownMenuShortcut
                        v-if="editor?.isActive({ textAlign: 'right' })"
                      >
                        <icon-lucide-check />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="
                        editor?.chain().focus().setTextAlign('justify').run()
                      "
                    >
                      <icon-lucide-align-justify /> Justify
                      <DropdownMenuShortcut
                        v-if="editor?.isActive({ textAlign: 'justify' })"
                      >
                        <icon-lucide-check />
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
                      <icon-lucide-subscript /> Subscript
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('subscript')"
                      >
                        <icon-lucide-check />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().toggleSuperscript().run()"
                    >
                      <icon-lucide-superscript /> Superscript
                      <DropdownMenuShortcut
                        v-if="editor?.isActive('superscript')"
                      >
                        <icon-lucide-check />
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    @click="editor?.chain().focus().unsetTextAlign().run()"
                  >
                    <icon-lucide-x /> Remove Alignment
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
          </ButtonGroup>

          <ButtonGroup>
            <Tooltip>
              <DropdownMenu>
                <TooltipTrigger as-child>
                  <DropdownMenuTrigger>
                    <Button variant="ghost" size="icon">
                      <icon-lucide-table />
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
                      <icon-lucide-plus /> Insert Table
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().deleteTable().run()"
                    >
                      <icon-lucide-trash /> Delete Table
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
                      <icon-lucide-arrow-left /> Add Column Before
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().addColumnAfter().run()"
                    >
                      <icon-lucide-arrow-right /> Add Column After
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().deleteColumn().run()"
                    >
                      <icon-lucide-trash /> Delete Column
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
                      <icon-lucide-arrow-up /> Add Row Before
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().addRowAfter().run()"
                    >
                      <icon-lucide-arrow-down /> Add Row After
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().deleteRow().run()"
                    >
                      <icon-lucide-trash /> Delete Row
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
                      <icon-lucide-combine /> Merge Cells
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().splitCell().run()"
                    >
                      <icon-lucide-split /> Split Cell
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().mergeOrSplit().run()"
                    >
                      <icon-lucide-split-square-horizontal /> Merge or Split
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
                      <icon-lucide-columns /> Toggle Header Column
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().toggleHeaderRow().run()"
                    >
                      <icon-lucide-rows /> Toggle Header Row
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().toggleHeaderCell().run()"
                    >
                      <icon-lucide-square /> Toggle Header Cell
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
                      <icon-lucide-arrow-right /> Go to Next Cell
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().goToPreviousCell().run()"
                    >
                      <icon-lucide-arrow-left /> Go to Previous Cell
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
                      <icon-lucide-settings /> Set Cell Attribute
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      @click="editor?.chain().focus().fixTables().run()"
                    >
                      <icon-lucide-wrench /> Fix Tables
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
                  <DropdownMenuTrigger>
                    <Button variant="ghost" size="icon">
                      <icon-lucide-link />
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
                      <icon-lucide-link /> Toggle Link
                      <DropdownMenuShortcut v-if="editor?.isActive('link')">
                        <icon-lucide-check />
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
                      <icon-lucide-external-link /> Set Link
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      :disabled="!editor?.isActive('link')"
                      @click="editor?.chain().focus().unsetLink().run()"
                    >
                      <icon-lucide-unlink /> Remove Link
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </Tooltip>
          </ButtonGroup>
        </TooltipProvider>
      </div>
    </BubbleMenu>
    <DragHandle v-if="editor" :editor="editor">
      <Button variant="ghost" size="icon-sm" class="mr-2 size-6">
        <icon-lucide-grip-vertical />
      </Button>
    </DragHandle>
    <div class="text-muted-foreground sticky bottom-0 border-t p-2 text-xs">
      {{ editor?.storage.characterCount.characters() }} characters /
      {{ editor?.storage.characterCount.words() }} words
      <Checkbox id="editable" v-model="editable" />
      <Label for="editable">Editable</Label>
      <Button size="icon" @click="copy(source)">
        <icon-lucide-copy v-if="!copied" />
        <icon-lucide-check v-else />
      </Button>
    </div>
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
