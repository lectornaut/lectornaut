import {
  useAddDoc,
  useDeleteDoc,
  useUpdateDoc,
} from "@/composables/useFirestore"
import { firestore } from "@/modules/firebase"
import type { ITeam } from "@/types"
import { collection } from "firebase/firestore"
import { defineStore } from "pinia"
import { useCollection } from "vuefire"

const teamRef = collection(firestore, "teams")

export const useTeamStore = defineStore("teams", () => {
  const teams = useCollection<ITeam>(teamRef)

  const add = (team: ITeam) => {
    useAddDoc(teamRef, team)
  }

  const del = (id: string, prevDoc: ITeam) => {
    useDeleteDoc(teamRef, id, prevDoc)
  }

  const update = (id: string, team: ITeam, prevDoc: ITeam) => {
    useUpdateDoc(teamRef, id, team, prevDoc)
  }

  return { teams, add, del, update }
})
