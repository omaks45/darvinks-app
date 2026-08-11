/*
  Warnings:

  - You are about to drop the column `recordedBy` on the `SecondaryPayment` table. All the data in the column will be lost.
  - Added the required column `recordedById` to the `SecondaryPayment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SecondaryPayment" DROP COLUMN "recordedBy",
ADD COLUMN     "recordedById" TEXT NOT NULL;

-- AddForeignKey
ALTER TABLE "SecondaryPayment" ADD CONSTRAINT "SecondaryPayment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
