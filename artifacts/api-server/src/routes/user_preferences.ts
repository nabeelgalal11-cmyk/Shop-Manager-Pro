import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, userBoardPreferencesTable } from "@workspace/db";
import {
  GetBoardPreferenceParams,
  GetBoardPreferenceResponse,
  UpdateBoardPreferenceParams,
  UpdateBoardPreferenceBody,
  UpdateBoardPreferenceResponse,
} from "@workspace/api-zod";
import { getUser } from "../lib/auth.js";

const router: IRouter = Router();

router.get("/boards/:boardKey", async (req, res): Promise<void> => {
  const u = getUser(req);
  if (!u) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const params = GetBoardPreferenceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(userBoardPreferencesTable)
    .where(
      and(
        eq(userBoardPreferencesTable.userId, u.id),
        eq(userBoardPreferencesTable.boardKey, params.data.boardKey),
      ),
    );

  res.json(
    GetBoardPreferenceResponse.parse({
      boardKey: params.data.boardKey,
      columnOrder: row?.columnOrder ?? [],
      hiddenColumns: row?.hiddenColumns ?? [],
    }),
  );
});

router.put("/boards/:boardKey", async (req, res): Promise<void> => {
  const u = getUser(req);
  if (!u) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const params = UpdateBoardPreferenceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateBoardPreferenceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [row] = await db
    .insert(userBoardPreferencesTable)
    .values({
      userId: u.id,
      boardKey: params.data.boardKey,
      columnOrder: body.data.columnOrder,
      hiddenColumns: body.data.hiddenColumns,
    })
    .onConflictDoUpdate({
      target: [
        userBoardPreferencesTable.userId,
        userBoardPreferencesTable.boardKey,
      ],
      set: {
        columnOrder: body.data.columnOrder,
        hiddenColumns: body.data.hiddenColumns,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  res.json(
    UpdateBoardPreferenceResponse.parse({
      boardKey: row.boardKey,
      columnOrder: row.columnOrder,
      hiddenColumns: row.hiddenColumns,
    }),
  );
});

export default router;
