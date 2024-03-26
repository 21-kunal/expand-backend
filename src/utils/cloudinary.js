import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadOnCloudinary = async (localFilePath) => {
    try {
        if (!localFilePath) return Error(`localFilePath does not exists`);

        const response = await cloudinary.uploader.upload(localFilePath, {
            resource_type: 'auto',
        });

        // console.log(
        //     `${localFilePath} file has been uploaded on cloudinary successfully`,
        //     response.url
        // );

        fs.unlinkSync(localFilePath);

        return response;
    } catch (error) {
        // remove the locally saved file as the upload operation got failed
        fs.unlinkSync(localFilePath);

        return Error(
            `Removed the file because error occurred. Error: ${error} `
        );
    }
};

export default uploadOnCloudinary;
