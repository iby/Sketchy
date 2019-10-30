import chalk from "chalk";
import program from "commander";
import fs from "fs-extra";
import path from "path";

// The Xcode's image set contents json file image entity structure.
interface ImageSetImage {
    idiom: string
    filename: string
    scale: string
    appearances?: [{ appearance: string, value: string }]
}

// The Xcode's image set contents json file structure.
interface ImageSetContents {
    images: ImageSetImage[]
    info: { version: number, author: string }
}

// An image set synchronization result.
class ImageSetSyncResult {
    public unassigned: boolean = false;
    public updated: string[] = [];
    public missing: string[] = [];
    public skipped: string[] = [];
}

// An asset catalog synchronization result.
interface AssetCatalogSyncResult {
    [i: string]: ImageSetSyncResult
}

// https://github.com/tj/commander.js
program
    .option("-s, --source <path>", "New asset location exported from Sketch")
    .option("-d, --destination <path>", "Xcode folder asset root")
    .parse(process.argv);

// Entrypoint…
(() => {
    const exportPath = program.source;
    const assetPath = program.destination;
    if (!exportPath || !assetPath) { throw new Error("The script requires both source and destination path CLI options, make sure to place `--` in front to instruct npm script to pass through the values.");}

    const assetCatalogs = fs.readdirSync(assetPath).filter((f) => path.extname(f) === ".xcassets");
    const result = assetCatalogs.map((file) => syncAssetCatalog(path.join(assetPath, file), exportPath));

    const unassignedImageSets = [] as string[];
    const updatedFiles = [] as string[];
    const missingFiles = [] as [string, string][];
    const skippedFiles = [] as string[];

    result.forEach((result) => {
        Object.entries(result).filter(([, r]) => r.unassigned).forEach(([i]) => unassignedImageSets.push(i));
        Object.entries(result).forEach(([, r]) => updatedFiles.push(...r.updated));
        Object.entries(result).forEach(([i, r]) => missingFiles.push(...(r.missing.map((f) => ([f, i])) as any)));
        Object.entries(result).forEach(([, r]) => skippedFiles.push(...r.skipped));
    });

    console.log(updatedFiles.length > 0 ? `\n${updatedFiles.length} files were updated:` : "\nNo files were updated…");
    updatedFiles.forEach((f) => console.log(`  ${chalk.gray("-")} ${chalk.green(f)}`));

    if (missingFiles.length > 0) { console.log(`\n${missingFiles.length} files were not found/updated:`); }
    missingFiles.forEach(([f, i]) => console.log(`  ${chalk.gray("-")} ${chalk.gray(f)} ${chalk.gray("/")} ${chalk.gray(i)}`));

    if (unassignedImageSets.length > 0) { console.log(`\n${unassignedImageSets.length} image sets contain unassigned files, you might want to check them out:`); }
    unassignedImageSets.forEach((i) => console.log(`  ${chalk.gray("-")} ${chalk.yellow(i)}`));

    if (skippedFiles.length > 0) { console.log(`\n${skippedFiles.length} files were not modified and skipped:`); }
    skippedFiles.forEach((f) => console.log(`  ${chalk.gray("-")} ${chalk.gray(f)}`));
})();

// Synchronizes the asset catalogue using images found in the source directory.
function syncAssetCatalog(assetCatalogPath: string, imageSourcePath: string): AssetCatalogSyncResult {
    const imageSets = fs.readdirSync(assetCatalogPath).filter((f) => path.extname(f) === ".imageset" || path.extname(f) === ".appiconset");
    const result = {} as AssetCatalogSyncResult;

    imageSets.forEach((imageSet) => {
        result[imageSet] = syncImageSet(path.join(assetCatalogPath, imageSet), imageSourcePath);
    });

    return result;
}

// Synchronizes the image set using images found in the source directory.
function syncImageSet(imageSetPath: string, imageSourcePath: string): ImageSetSyncResult {
    const contentsPath = path.join(imageSetPath, "Contents.json");
    const contents = JSON.parse(fs.readFileSync(contentsPath, "utf8")) as ImageSetContents;
    const result = new ImageSetSyncResult();
    let needsContentsUpdate = false;

    contents.images.forEach((image) => {
        const oldImagePath = image.filename && path.join(imageSetPath, image.filename);
        const newImagePath = findImagePath(imageSetPath, imageSourcePath, image);
        const oldStat = oldImagePath && fs.existsSync(oldImagePath) && fs.statSync(oldImagePath);
        const newStat = newImagePath && fs.existsSync(newImagePath) && fs.statSync(newImagePath);

        if (!newImagePath) {
            if (image.filename === undefined) { result.unassigned = true; } else { result.missing.push(image.filename); }
            return;
        }

        if (!oldImagePath || path.basename(oldImagePath) !== path.basename(newImagePath)) {
            if (oldImagePath) { fs.removeSync(oldImagePath); }
            image.filename = path.basename(newImagePath);
            needsContentsUpdate = true;
        } else if (oldStat && newStat && newStat.size === oldStat.size && Math.round(newStat.mtimeMs) === Math.round(oldStat.mtimeMs)) {
            result.skipped.push(image.filename);
            return;
        }

        fs.copySync(newImagePath, path.join(imageSetPath, path.basename(newImagePath)), {preserveTimestamps: true});
        result.updated.push(image.filename);
    });

    // Xcode uses fucking weirdo JSON formatting…
    if (needsContentsUpdate) { fs.writeFileSync(contentsPath, JSON.stringify(contents, null, 2).replace(/": /, `" : `)); }
    return result;
}

// Looks up the new image in the source directory for the given image set's image entity. There're multiple rules for naming images,
// so it might be not necessarily the image with the same filename.
function findImagePath(imageSetPath: string, imageSourcePath: string, image: ImageSetImage): string | undefined {
    let imagePath;

    // If image filename exists in the source simply return it. Image filename will be undefined if no image is assigned.
    if (image.filename && fs.existsSync(imagePath = path.join(imageSourcePath, image.filename))) { return imagePath; }

    // Otherwise try looking up using image set filename.
    const appearance = image.appearances == undefined ? "" : `-${image.appearances[0].value}`;
    const scale = image.scale == "1x" ? "" : `@${image.scale}`;
    let filename = `${path.basename(imageSetPath, path.extname(imageSetPath)).replace(/\./ig, "-").toLowerCase()}`;

    // Try with explicit appearance first.
    if (fs.existsSync(imagePath = `${path.join(imageSourcePath, `${filename}${appearance}${scale}.png`)}`)) { return imagePath; }

    // Try light appearance after as it's typically not included in the image set contents file.
    if (fs.existsSync(imagePath = `${path.join(imageSourcePath, `${filename}-light${scale}.png`)}`)) { return imagePath; }

    return undefined;
}
