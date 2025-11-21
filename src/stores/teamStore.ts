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
  const { data: teams, pending: isLoading } = useCollection<ITeam>(teamRef)

  const add = (team: ITeam) => {
    useAddDoc<ITeam>(teamRef, team)
  }

  const del = (id: string, prevDoc: ITeam) => {
    useDeleteDoc<ITeam>(teamRef, id, prevDoc)
  }

  const update = (id: string, team: Partial<ITeam>, prevDoc: ITeam) => {
    useUpdateDoc<ITeam>(teamRef, id, team, prevDoc)
  }

  return { teams, isLoading, add, del, update }
})
