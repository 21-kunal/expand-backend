import { apiError } from '../utils/apiError.js';
import { apiResponse } from '../utils/apiResponse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { User } from '../models/user.model.js';
import {
    uploadOnCloudinary,
    deleteFileOnCloudinary,
} from '../utils/cloudinary.js';
import jwt from 'jsonwebtoken';

const generateAccessAndRefreshToken = async (userId) => {
    try {
        const user = await User.findById(userId);
        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();

        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave: false });

        return { accessToken, refreshToken };
    } catch (error) {
        throw new apiError(
            500,
            'Something went wrong while creating access and refresh token'
        );
    }
};

function validateEmail(email) {
    if (!email) return false;

    const parts = email.split('@');

    if (parts.length !== 2) return false;

    const localPart = parts[0];
    const domainPart = parts[1];

    if (!localPart || !domainPart) return false;

    // at least one '.' in the domain part
    if (domainPart.indexOf('.') === -1) return false;

    // the last '.' in the domain part is not the last character
    if (domainPart.lastIndexOf('.') === domainPart.length - 1) return false;

    return true;
}

function validatePassword(password) {
    if (password.length < 8) return 'Length of password should be at least 8.';

    let hasUppercase = false;
    let hasLowercase = false;
    let hasDigit = false;
    let hasSpecialChar = false;

    for (let i = 0; i < password.length; i++) {
        const char = password[i];

        if (char >= 'A' && char <= 'Z') hasUppercase = true;
        else if (char >= 'a' && char <= 'z') hasLowercase = true;
        else if (char >= '0' && char <= '9') hasDigit = true;
        else hasSpecialChar = true;
    }

    if (!hasUppercase)
        return 'Password should contain at least one uppercase letter';
    if (!hasLowercase)
        return 'Password should contain at least one lowercase letter';
    if (!hasSpecialChar)
        return 'Password should contain at least one special character';
    if (!hasDigit) return 'Password should contain at least one digit';

    return '';
}

const registerUser = asyncHandler(async (req, res) => {
    // get user details from frontend
    const { fullName, email, username, password } = req.body;

    // validation of user details
    // noob way
    // if (fullName === '') {
    //     throw new apiError(400, 'fullName is required');
    // }

    // advance way
    if (
        [fullName, username, email, password].some((field) => {
            return field.trim() === '';
        })
    ) {
        throw new apiError(400, 'All fields are required');
    }

    if (!validateEmail(email)) {
        throw new apiError(400, 'Enter a valid email');
    }
    if (validatePassword(password) !== '') {
        throw new apiError(400, validatePassword(password));
    }

    // check if user already exists: email, username
    const existedUser = await User.findOne({ $or: [{ email }, { username }] });

    if (existedUser) {
        throw new apiError(409, 'User with username or email already exists');
    }

    // check for coverImage(optional) and avatar
    // console.log('req : ', req);
    // console.log('req.files : ', req.files);
    const avatarLocalPath = req.files?.avatar[0]?.path;
    // const coverImageLocalPath = req.files?.coverImage[0]?.path;
    let coverImageLocalPath;

    if (
        req.files &&
        Array.isArray(req.files.coverImage) &&
        req.files.coverImage.length > 0
    ) {
        coverImageLocalPath = req.files.coverImage[0].path;
    }

    if (!avatarLocalPath) {
        throw new apiError(400, 'Avatar file is required');
    }

    // upload them to cloudinary
    const avatarResponse = await uploadOnCloudinary(avatarLocalPath);
    const coverImageResponse = await uploadOnCloudinary(coverImageLocalPath);

    // console.log('avatarResponse : ', avatarResponse);
    // console.log('coverImageResponse : ', coverImageResponse);

    if (!avatarResponse) {
        throw new apiError(400, 'Avatar file is required');
    }

    // create user object - save the user in db
    const user = await User.create({
        username: username,
        email: email,
        fullName: fullName,
        avatar: avatarResponse.url,
        coverImage: coverImageResponse?.url || '',
        password: password,
    });

    // remove password and refresh token field from response
    const createdUser = await User.findById(user._id).select(
        '-password -refreshToken'
    );

    // check for user creation
    if (!createdUser) {
        throw new apiError(
            500,
            'Something went wrong while registering the user'
        );
    }

    // return response
    return res
        .status(201)
        .json(
            new apiResponse(200, createdUser, 'User registered successfully')
        );
});

const loginUser = asyncHandler(async (req, res) => {
    // get email and password of the user form frontend

    const { email, username, password } = req.body;

    // check if the email and password is empty or not
    if (!(email || username)) {
        throw new apiError(400, 'Username or Email is required');
    }

    // now try to find the user in db with the help of email
    const user = await User.findOne({ $or: [{ username }, { email }] });

    if (!user) {
        throw new apiError(404, 'User does not exists.');
    }

    //console.log(user.isPasswordCorrect);
    // after finding the user verify password
    const isPasswordCorrect = await user.isPasswordCorrect(password);

    if (!isPasswordCorrect) {
        throw new apiError(401, 'Password is incorrect');
    }

    // access and refresh token
    const { accessToken, refreshToken } = await generateAccessAndRefreshToken(
        user._id
    );

    const loggedInUser = await User.findById(user._id).select(
        '-password -refreshToken'
    );

    // send access and refresh token in form of cookie
    const options = { httpOnly: true, secure: true };

    return res
        .status(200)
        .cookie('accessToken', accessToken, options)
        .cookie('refreshToken', refreshToken, options)
        .json(
            new apiResponse(
                200,
                {
                    user: loggedInUser,
                    accessToken,
                    refreshToken,
                },
                'User logged in successfully'
            )
        );
});

const logoutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(req.user._id, {
        $set: { refreshToken: undefined },
    });

    const options = { httpOnly: true, secure: true };

    return res
        .status(200)
        .clearCookie('accessToken', options)
        .clearCookie('refreshToken', options)
        .json(new apiResponse(200, {}, 'User logged out'));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken =
        req.cookie.refreshToken || req.body.refreshToken;

    if (!incomingRefreshToken) {
        throw new apiError(401, 'unauthorized request');
    }

    const decodedToken = jwt.verify(
        incomingRefreshToken,
        process.env.REFRESH_TOKEN_SECRET
    );

    const user = await User.findById(decodedToken?._id);

    if (!user) {
        throw new apiError(401, 'Invalid refresh token');
    }

    if (incomingRefreshToken !== user?.refreshToken) {
        throw new apiError(401, 'Refresh Token is expired or used');
    }

    const options = { httpOnly: true, secure: true };
    const { newAccessToken, newRefreshToken } =
        await generateAccessAndRefreshToken(user._id);

    return res
        .status(200)
        .cookie('accessToken', newAccessToken, options)
        .cookie('refreshToken', newRefreshToken, options)
        .json(
            new apiResponse(
                200,
                { accessToken: newAccessToken, refreshToken: newRefreshToken },
                'Access Token and Refresh Token is created successfully'
            )
        );
});

const changeCurrentPassword = asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    const user = await User.findById(req.user?._id);
    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);

    if (!isPasswordCorrect) {
        throw new apiError(400, 'Invalid password');
    }

    user.password = newPassword;
    await user.save({ validateBeforeSave: false });

    return res
        .status(200)
        .json(new apiResponse(200, {}, 'Password Change successfully'));
});

const getCurrentUser = asyncHandler(async (req, res) => {
    return res
        .status(200)
        .json(
            new apiResponse(200, req.user, 'Current User Fetched Successfully')
        );
});

const updateAccountDetails = asyncHandler(async (req, res) => {
    const { fullName, email } = req.body;

    if (!fullName || !email) {
        throw new apiError(400, 'All field are required');
    }

    const user = await User.findByIdAndUpdate(
        req.user?._id,
        {
            $set: { fullName: fullName, email: email },
        },
        { new: true }
    ).select('-password');

    return res
        .status(200)
        .json(
            new apiResponse(200, user, 'Account details updated successfully')
        );
});

const updateUserAvatar = asyncHandler(async (req, res) => {
    const avatarLocalPath = req.file?.path;

    if (!avatarLocalPath) {
        throw new apiError(400, 'Avatar file is missing');
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath);

    if (!avatar.url) {
        throw new apiError(500, 'Error while uploading avatar');
    }

    const user = await User.findById(req.user?._id);
    const oldAvatarURL = user.avatar;

    user.avatar = avatar.url;
    await user.save({ validateBeforeSave: false });

    await deleteFileOnCloudinary(oldAvatarURL);

    return res
        .status(200)
        .json(new apiResponse(200, user, 'Avatar image updated successfully'));
});

const updateUserCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalPath = req.file?.path;

    if (!coverImageLocalPath) {
        throw new apiError(400, 'Cover Image file is missing');
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath);

    if (!coverImage.url) {
        throw new apiError(500, 'Error while uploading Cover Image');
    }

    const user = await User.findById(req.user?._id).select(
        '-password -refreshToken'
    );
    // console.log(user);
    const oldCoverImageURL = user.coverImage;

    user.coverImage = coverImage.url;
    await user.save({ validateBeforeSave: false });

    if (oldCoverImageURL !== '') {
        await deleteFileOnCloudinary(oldCoverImageURL);
    }

    return res
        .status(200)
        .json(
            new apiResponse(200, user, 'Cover Image image updated successfully')
        );
});

const getUserChannelProfile = asyncHandler(async (req, res) => {
    const { username } = req.params;

    if (!username?.trim()) {
        throw new ApiError(400, 'username is missing');
    }

    const channel = await User.aggregate([
        {
            $match: {
                username: username?.toLowerCase(),
            },
        },
        {
            $lookup: {
                from: 'subscriptions',
                localField: '_id',
                foreignField: 'channel',
                as: 'subscribers',
            },
        },
        {
            $lookup: {
                from: 'subscriptions',
                localField: '_id',
                foreignField: 'subscriber',
                as: 'subscribed',
            },
        },
        {
            $addFields: {
                subscribersCount: {
                    $size: '$subscribers',
                },
                subscribedCount: {
                    $size: '$subscribed',
                },
                isSubscribed: {
                    $cond: {
                        if: { $in: [req.user?._id, '$subscribers.subscriber'] },
                        then: true,
                        else: false,
                    },
                },
            },
        },
        {
            $project: {
                fullName: 1,
                username: 1,
                subscribersCount: 1,
                subscribedCount: 1,
                isSubscribed: 1,
                avatar: 1,
                coverImage: 1,
                email: 1,
            },
        },
    ]);

    if (!channel?.length) {
        throw new apiError(404, 'channel does not exists');
    }

    return res
        .status(200)
        .json(
            new apiResponse(
                200,
                channel[0],
                'User channel fetched successfully'
            )
        );
});

export {
    registerUser,
    loginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCoverImage,
};
