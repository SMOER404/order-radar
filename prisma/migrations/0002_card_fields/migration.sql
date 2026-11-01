-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "estHoursMax" DOUBLE PRECISION,
ADD COLUMN     "estHoursMin" DOUBLE PRECISION,
ADD COLUMN     "offersCount" INTEGER,
ADD COLUMN     "questions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "summary" TEXT;

