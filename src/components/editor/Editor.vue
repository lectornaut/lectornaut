<script setup lang="ts">
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

const lowlight = createLowlight(common)

const editor = useEditor({
  content: "",
  onCreate: ({ editor: currentEditor }) => {
    migrateMathStrings(currentEditor)
  },
  editorProps: {
    attributes: {
      class:
        "focus:outline-none border border-red-400 px-8 py-2 prose prose-sm max-w-none dark:prose-invert prose-stone dark:prose-zinc",
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
      lowlight,
    }),
    Details.configure({
      persist: true,
      HTMLAttributes: {
        class: "details",
      },
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
})

onBeforeUnmount(() => {
  editor?.value?.destroy()
})
</script>

<template>
  <div>
    <Button
      @click="
        editor
          ?.chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run()
      "
    >
      Insert table
    </Button>
    <Button @click="editor?.chain().focus().addColumnBefore().run()"
      >Add column before</Button
    >
    <Button @click="editor?.chain().focus().addColumnAfter().run()"
      >Add column after</Button
    >
    <Button @click="editor?.chain().focus().deleteColumn().run()"
      >Delete column</Button
    >
    <Button @click="editor?.chain().focus().addRowBefore().run()"
      >Add row before</Button
    >
    <Button @click="editor?.chain().focus().addRowAfter().run()"
      >Add row after</Button
    >
    <Button @click="editor?.chain().focus().deleteRow().run()"
      >Delete row</Button
    >
    <Button @click="editor?.chain().focus().deleteTable().run()"
      >Delete table</Button
    >
    <Button @click="editor?.chain().focus().mergeCells().run()"
      >Merge cells</Button
    >
    <Button @click="editor?.chain().focus().splitCell().run()"
      >Split cell</Button
    >
    <Button @click="editor?.chain().focus().toggleHeaderColumn().run()"
      >Toggle header column</Button
    >
    <Button @click="editor?.chain().focus().toggleHeaderRow().run()"
      >Toggle header row</Button
    >
    <Button @click="editor?.chain().focus().toggleHeaderCell().run()"
      >Toggle header cell</Button
    >
    <Button @click="editor?.chain().focus().mergeOrSplit().run()"
      >Merge or split</Button
    >
    <Button
      @click="editor?.chain().focus().setCellAttribute('colspan', 2).run()"
      >Set cell attribute</Button
    >
    <Button @click="editor?.chain().focus().fixTables().run()"
      >Fix tables</Button
    >
    <Button @click="editor?.chain().focus().goToNextCell().run()"
      >Go to next cell</Button
    >
    <Button @click="editor?.chain().focus().goToPreviousCell().run()"
      >Go to previous cell</Button
    >
    <Button
      :variant="editor?.isActive('highlight') ? 'default' : 'outline'"
      @click="editor?.chain().focus().toggleHighlight().run()"
    >
      <icon-lucide-highlighter />
    </Button>
    <Button
      :variant="editor?.isActive('link') ? 'default' : 'outline'"
      @click="
        editor
          ?.chain()
          .focus()
          .toggleLink({ href: 'https://example.com' })
          .run()
      "
    >
      <icon-lucide-link />
    </Button>
    <Button
      :variant="editor?.isActive('subscript') ? 'default' : 'outline'"
      @click="editor?.chain().focus().toggleSubscript().run()"
    >
      <icon-lucide-subscript />
    </Button>
    <Button
      :variant="editor?.isActive('superscript') ? 'default' : 'outline'"
      @click="editor?.chain().focus().toggleSuperscript().run()"
    >
      <icon-lucide-superscript />
    </Button>
    <Button @click="editor?.chain().focus().undo().run()">
      <icon-lucide-undo />
    </Button>
    <Button @click="editor?.chain().focus().redo().run()">
      <icon-lucide-redo />
    </Button>
    <Button
      :variant="editor?.isActive('highlight') ? 'default' : 'outline'"
      @click="editor?.chain().focus().toggleHighlight().run()"
    >
      Toggle highlight
    </Button>
    <Button
      :variant="
        editor?.isActive('highlight', { color: '#ffc078' })
          ? 'default'
          : 'outline'
      "
      @click="
        editor?.chain().focus().toggleHighlight({ color: '#ffc078' }).run()
      "
    >
      Orange
    </Button>
    <Button
      :variant="
        editor?.isActive('highlight', { color: '#8ce99a' })
          ? 'default'
          : 'outline'
      "
      @click="
        editor?.chain().focus().toggleHighlight({ color: '#8ce99a' }).run()
      "
    >
      Green
    </Button>
    <Button
      :variant="
        editor?.isActive('highlight', { color: '#74c0fc' })
          ? 'default'
          : 'outline'
      "
      @click="
        editor?.chain().focus().toggleHighlight({ color: '#74c0fc' }).run()
      "
    >
      Blue
    </Button>
    <Button
      :variant="
        editor?.isActive('highlight', { color: '#b197fc' })
          ? 'default'
          : 'outline'
      "
      @click="
        editor?.chain().focus().toggleHighlight({ color: '#b197fc' }).run()
      "
    >
      Purple
    </Button>
    <Button
      :variant="
        editor?.isActive('highlight', { color: 'red' }) ? 'default' : 'outline'
      "
      @click="editor?.chain().focus().toggleHighlight({ color: 'red' }).run()"
    >
      Red ('red')
    </Button>
    <Button
      :variant="
        editor?.isActive('highlight', { color: '#ffa8a8' })
          ? 'default'
          : 'outline'
      "
      @click="
        editor?.chain().focus().toggleHighlight({ color: '#ffa8a8' }).run()
      "
    >
      Red (#ffa8a8)
    </Button>
    <Button
      :disabled="!editor?.isActive('highlight')"
      @click="editor?.chain().focus().unsetHighlight().run()"
    >
      Unset highlight
    </Button>
    <Button
      :variant="editor?.isActive('link') ? 'default' : 'outline'"
      @click="
        editor?.getAttributes('link').href !== null
          ? editor?.getAttributes('link').href === ''
            ? editor?.chain().focus().extendMarkRange('link').unsetLink().run()
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
      >Set link</Button
    >
    <Button
      :disabled="!editor?.isActive('link')"
      @click="editor?.chain().focus().unsetLink().run()"
    >
      Unset link
    </Button>
    <button
      :variant="
        editor?.isActive('textStyle', { backgroundColor: '#958DF1' })
          ? 'default'
          : 'outline'
      "
      @click="editor?.chain().focus().setBackgroundColor('#958DF1').run()"
    >
      Purple
    </button>
    <button
      :variant="
        editor?.isActive('textStyle', { backgroundColor: '#F98181' })
          ? 'default'
          : 'outline'
      "
      @click="editor?.chain().focus().setBackgroundColor('#F98181').run()"
    >
      Red
    </button>
    <button @click="editor?.chain().focus().unsetBackgroundColor().run()">
      Unset color
    </button>
    <button
      :variant="
        editor?.isActive('textStyle', { fontFamily: 'Inter' })
          ? 'default'
          : 'outline'
      "
      @click="editor?.chain().focus().setFontFamily('Inter').run()"
    >
      Inter
    </button>
    <button
      :variant="
        editor?.isActive('textStyle', {
          fontFamily: 'Comic Sans MS, Comic Sans',
        })
          ? 'default'
          : 'outline'
      "
      @click="
        editor?.chain().focus().setFontFamily('Comic Sans MS, Comic Sans').run()
      "
    >
      Comic Sans
    </button>
    <button
      :variant="
        editor?.isActive('textStyle', { fontFamily: 'serif' })
          ? 'default'
          : 'outline'
      "
      @click="editor?.chain().focus().setFontFamily('serif').run()"
    >
      Serif
    </button>
    <button
      :variant="
        editor?.isActive('textStyle', { fontFamily: 'sans-serif' })
          ? 'default'
          : 'outline'
      "
      @click="editor?.chain().focus().setFontFamily('monospace').run()"
    >
      Monospace
    </button>
    <button
      :variant="
        editor?.isActive('textStyle', { fontFamily: 'cursive' })
          ? 'default'
          : 'outline'
      "
      @click="editor?.chain().focus().setFontFamily('cursive').run()"
    >
      Cursive
    </button>
    <button @click="editor?.chain().focus().unsetFontFamily().run()">
      Unset font family
    </button>
    <button
      :variant="
        editor?.isActive('textStyle', { fontSize: '28px' })
          ? 'default'
          : 'outline'
      "
      @click="editor?.chain().focus().setFontSize('28px').run()"
    >
      Font size 28px
    </button>
    <button
      :variant="
        editor?.isActive('textStyle', { fontSize: '32px' })
          ? 'default'
          : 'outline'
      "
      @click="editor?.chain().focus().setFontSize('32px').run()"
    >
      Font size 32px
    </button>
    <button @click="editor?.chain().focus().unsetFontSize().run()">
      Unset font size
    </button>
    <button @click="editor?.commands.showInvisibleCharacters()">
      Show invisible characters
    </button>
    <!-- Works as well -->
    <button @click="editor?.commands.showInvisibleCharacters(false)">
      showInvisibleCharacters(false)
    </button>
    <button @click="editor?.commands.hideInvisibleCharacters()">
      Hide invisible characters
    </button>
    <button @click="editor?.commands.toggleInvisibleCharacters()">
      Toggle invisible characters
    </button>
    <!-- <input
      type="checkbox"
      :checked="editor?.storage.invisibleCharacters.visibility()"
      @change="
        (event) =>
          editor?.commands.showInvisibleCharacters(event.currentTarget.checked)
      "
    />
    <label for="show-invisible-characters">Show invisibles</label> -->
    <button
      :variant="editor?.isActive({ textAlign: 'left' }) ? 'default' : 'outline'"
      @click="editor?.chain().focus().setTextAlign('left').run()"
    >
      Left
    </button>
    <button
      :variant="
        editor?.isActive({ textAlign: 'center' }) ? 'default' : 'outline'
      "
      @click="editor?.chain().focus().setTextAlign('center').run()"
    >
      Center
    </button>
    <button
      :variant="
        editor?.isActive({ textAlign: 'right' }) ? 'default' : 'outline'
      "
      @click="editor?.chain().focus().setTextAlign('right').run()"
    >
      Right
    </button>
    <button
      :variant="
        editor?.isActive({ textAlign: 'justify' }) ? 'default' : 'outline'
      "
      @click="editor?.chain().focus().setTextAlign('justify').run()"
    >
      Justify
    </button>
    <button @click="editor?.chain().focus().unsetTextAlign().run()">
      Unset text align
    </button>
  </div>
  <EditorContent :editor="editor" />
  <BubbleMenu v-if="editor" :editor="editor">
    <div
      class="bg-card text-card-foreground flex gap-1 rounded-lg border p-1 shadow-lg"
    >
      <TooltipProvider>
        <DropdownMenu>
          <DropdownMenuTrigger> list </DropdownMenuTrigger>
          <DropdownMenuContent class="w-48">
            <DropdownMenuLabel class="text-muted-foreground text-xs">
              Turn into
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem
                @click="editor?.chain().focus().setParagraph().run()"
              >
                <icon-lucide-type /> Paragraph
                <DropdownMenuShortcut v-if="editor?.isActive('paragraph')">
                  <icon-lucide-check />
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                @click="
                  editor?.chain().focus().toggleHeading({ level: 1 }).run()
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
                  editor?.chain().focus().toggleHeading({ level: 2 }).run()
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
                  editor?.chain().focus().toggleHeading({ level: 3 }).run()
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
                <DropdownMenuShortcut v-if="editor?.isActive('bulletList')">
                  <icon-lucide-check />
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                @click="editor?.chain().focus().toggleOrderedList().run()"
              >
                <icon-lucide-list-ordered /> Numbered list
                <DropdownMenuShortcut v-if="editor?.isActive('orderedList')">
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
                <DropdownMenuShortcut v-if="editor?.isActive('codeBlock')">
                  <icon-lucide-check />
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                @click="editor?.chain().focus().toggleBlockquote().run()"
              >
                <icon-lucide-quote /> Blockquote
                <DropdownMenuShortcut v-if="editor?.isActive('blockquote')">
                  <icon-lucide-check />
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger>
            <Toggle
              size="sm"
              :model-value="editor?.isActive('bold')"
              @click="editor?.chain().focus().toggleBold().run()"
            >
              <icon-lucide-bold />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Bold</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <Toggle
              size="sm"
              :model-value="editor?.isActive('italic')"
              @click="editor?.chain().focus().toggleItalic().run()"
            >
              <icon-lucide-italic />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Italic</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <Toggle
              size="sm"
              :model-value="editor?.isActive('underline')"
              @click="editor?.chain().focus().toggleUnderline().run()"
            >
              <icon-lucide-underline />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Underline</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <Toggle
              size="sm"
              :model-value="editor?.isActive('strike')"
              @click="editor?.chain().focus().toggleStrike().run()"
            >
              <icon-lucide-strikethrough />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Strike</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <Toggle
              size="sm"
              :model-value="editor?.isActive('code')"
              @click="editor?.chain().focus().toggleCode().run()"
            >
              <icon-lucide-braces />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>Code</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  </BubbleMenu>
  <DragHandle v-if="editor" :editor="editor">
    <Button size="icon" variant="ghost">
      <icon-lucide-grip-vertical />
    </Button>
  </DragHandle>
  {{ editor?.storage.characterCount.characters() }} characters /
  {{ editor?.storage.characterCount.words() }} words
</template>

<style lang="scss">
/* Basic editor styles */
.tiptap {
  :first-child {
    margin-top: 0;
  }

  /* Task list specific styles */
  ul[data-type="taskList"] {
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
    }
  }

  /* Details */
  .details {
    list-style: none;
    display: flex;
    gap: 0.25rem;
    margin: 0;
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
        background-color: lightgray;
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
      gap: 0.5rem;
      width: 100%;

      > [data-type="detailsContent"] > :last-child {
        margin-bottom: 0.5rem;
      }
    }

    .details {
      margin: 0.5rem 0;
    }
  }
}
</style>
