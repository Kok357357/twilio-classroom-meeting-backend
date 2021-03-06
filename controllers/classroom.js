let Classroom = require('../models/Classroom.js');
let Attendance = require('../models/Attendance.js');
let mongoose = require('mongoose');

let twilioOptions = require('../config/twilio.js');

const accountSid = twilioOptions.TWILIO_ACCOUNT_SID;
const authToken = twilioOptions.TWILIO_ACCOUNT_AUTH_TOKEN;
const twilioApiKey = twilioOptions.TWILIO_API_KEY;
const twilioApiSecret = twilioOptions.TWILIO_API_SECRET;
const tw = require('twilio')(accountSid, authToken);
const AccessToken = require('twilio').jwt.AccessToken;
const serviceId = twilioOptions.TWILIO_IPM_SERVICE_SID;

const webhookRoomCallbackUrl = "webhook/roomCallback";
const webhookCompositionCallbackUrl = "webhook/compositionCallback";

let twClient = tw.video;
let twErrorDic = {
    53113: "Room exists!",
    53101: "Room name is too long!"
}

// get all the classrooms over all the universities
exports.getAllClassrooms = function(req, res) {
    twClient.rooms.list()
        .then(rooms => { return res.json({ success: true, data: rooms, status: 200 }) });
}

// delete all classrooms
exports.delAllClassrooms = function(req, res) {
    Classroom.remove({}, function(err, data) { // remove room
        if (err) {
            return res.json({ success: false, status: 500, msg: err });
        } else if (data != undefined && data != null) {
            return res.json({ success: true, data: data, status: 200 });
        } else {
            return res.json({ success: false, status: 404 });
        }
    });
}

// delete all the classrooms in the given university
exports.delAllClassroomsByUniversity = function(req, res) {
    let universityId = req.params.id;
    if (universityId != undefined && universityId != null) {
        Classroom.remove({ universityId: universityId }, function(err, data) { // remove room
            if (err) {
                return res.json({ success: false, status: 500, msg: "DB error" });
            } else if (data != undefined && data != null) {
                return res.json({ success: true, data: data, status: 200 });
            } else {
                return res.json({ success: false, status: 404, msg: "Not Found" });
            }
        });
    } else {
        return res.json({ success: false, status: 400, msg: "University ID undefiend." })
    }
}

// get all the classrooms in the university
exports.getAllClassroomsByUniversity = function(req, res) {
    let universityId = req.params.id;
    if (universityId != undefined && universityId != null) {
        Classroom.find({ universityId: universityId }, function(err, data) { // finding room
            if (err) {
                return res.json({ success: false, status: 500, msg: "DB error" });
            } else if (data != undefined && data != null) {
                return res.json({ success: true, data: data, status: 200 });
            } else {
                return res.json({ success: false, status: 404, msg: "Not Found" });
            }
        });
    } else {
        return res.json({ success: false, status: 400, msg: "University ID undefiend." })
    }
}

// create the classroom
exports.createUniversityClassroom = function(req, res) {
    let mobile = req.body.mobile;
    let accountId = req.account._id;
    let universityId = req.body.uid;
    let uniqueName = req.body.roomName
    let privilege = req.body.privilege;
    let teacherId = req.body.tid;
    let markAttendance = req.body.markAttendance;
    let schedule = req.body.schedule;

    if (privilege >= 99) { // only administrator can creat the room
        let newRoom = new Classroom();

        newRoom.uniqueName = uniqueName; // classroom unique name
        newRoom.universityId = universityId; // university id
        newRoom.accountSid = accountId; // user id (student or company id)
        newRoom.teacher = teacherId;
        newRoom.markAttendance = markAttendance;
        newRoom.schedule = schedule;
        newRoom.statusCallback = `https://${req.headers.host}/classroom/${webhookRoomCallbackUrl}`; // setting up call back url for the classroom event
        newRoom.minPrivilege = 0; // minimum privilege of the user who can join to the classroom (not used now and every body who logged can join)
        newRoom.type = "group"; // classroom type (there are 3 types ['group', 'small group', 'peer to peer])
        newRoom.members = []; // all the participants who are in the current classroom

        newRoom.save(function(err, doc) { // saving created room to the db
            if (err)
                return res.json({ success: false, status: 500, msg: err });
            else if (doc != undefined && doc != null) {
                return res.json({ success: true, status: 201, data: { id: doc._id, roomData: doc } });
            } else
                return res.json({ success: false, status: 404, msg: "Not created!" });
        });
    } else
        return res.json({ success: false, status: 403, msg: "Insufficient Privilege" });
}

// create twilio classroom
exports.createTwilioClassroom = function(req, res) {
    let cid = req.body.cid;

    Classroom.findOne({ _id: cid }, function(err, data) { // finding room
        if (err)
            return res.json({ success: false, status: 500, msg: "DB error" });
        else if (data != undefined && data != null) {
            twClient.rooms.create({ // create the room
                    uniqueName: data.uniqueName + data.accountSid + data.universityId,
                    statusCallback: data.statusCallback,
                    recordParticipantsOnConnect: true,
                })
                .then(room => { // creation success
                    let classroom = data;
                    classroom.roomSID = room.sid;
                    classroom.save(function(err, doc) { // saving created room to the db
                        if (err)
                            return res.json({ success: false, status: 500, msg: err });
                        else if (doc != undefined && doc != null) {
                            tw.chat.services(serviceId)
                                .channels
                                .create({
                                    friendlyName: "welovechannel",
                                    uniqueName: doc["_id"].toString(),
                                    type: 'public',
                                })
                                .then(channel => {
                                    return res.json({ success: true, status: 201, data: { id: doc._id, sid: room.sid, roomData: doc, channelData: channel } });
                                }).catch(message => {
                                    return res.json({ success: false, status: 400, msg: message })
                                })
                        } else
                            return res.json({ success: false, status: 404, msg: "Not created!" });
                    });
                })
                .catch(message => { // creation fail
                    return res.json({ success: false, status: 400, msg: twErrorDic[message.code] })
                });
        } else
            return res.json({ success: false, status: 404, msg: "Not Found" });
    });
}


// get all the classrooms by room creater and university id.
exports.getClassroomsByAdmin = function(req, res) {
    let accountId = req.account._id;
    let universityId = req.params.id;

    Classroom.find({ accountSid: accountId, universityId: universityId }, function(err, data) { // finding room
        if (err)
            return res.json({ success: false, status: 500, msg: "DB error" });
        else if (data != undefined && data != null)
            return res.json({ success: true, status: 200, data: data });
        else
            return res.json({ success: false, status: 404, msg: "Not Found" });
    });
}

// get the classroom by room sid
exports.getClassroomByRoomId = function(req, res) {
    let roomId = req.params.cid;

    Classroom.findOne({ _id: roomId }, function(err, data) { // finding room
        if (err)
            return res.json({ success: false, status: 500, msg: "DB error" });
        else if (data != undefined && data != null)
            return res.json({ success: true, status: 200, data: data });
        else
            return res.json({ success: false, status: 404, msg: "Not Found" });
    });
}

// update classroom
exports.updateClassroom = function(req, res) {
    let classroomUpdates = {};

    // classroom id
    let roomId = req.params.cid;

    /* Classroom attributes in body */
    let teacherId = req.body.tid;
    let markAttendance = req.body.markAttendance;
    let weightAge = req.body.weightAge;
    let privilege = req.body.privilege;
    let status = req.body.status;
    let roomName = req.body.roomName;
    let schedule = req.body.schedule;

    if (teacherId != undefined || teacherId != null) {
        classroomUpdates.teacher = teacherId;
    }

    if (markAttendance != undefined || markAttendance != null) {
        classroomUpdates.markAttendance = markAttendance;
    }

    if (weightAge != undefined || weightAge != null) {
        classroomUpdates.weightAge = weightAge;
    }

    if (status != undefined || status != null) {
        classroomUpdates.status = status;
    }

    if (roomName != undefined || roomName != null) {
        classroomUpdates.uniqueName = roomName;
    }

    if (schedule != undefined || schedule != null) {
        classroomUpdates.schedule = schedule;
    }

    if (privilege >= 99) { // only administrator can creat the room
        Classroom.findOneAndUpdate({ _id: roomId }, classroomUpdates, { new: true }, function(err, doc) {
            if (err) {
                return res.json({ success: false, status: 500, err: err.message });
            } else if (doc != undefined && doc != null) {
                return res.json({ success: true, status: 200, data: doc });
            } else {
                return res.json({ success: false, status: 404 });
            }
        });
    } else
        return res.json({ success: false, status: 403, msg: "Insufficient Privilege" });
}

// get attendances array in the classroom
exports.getAttendancesByClassroom = function(req, res) {
    let roomId = req.params.cid;

    Attendance.find({ classroomId: roomId }, function(err, data) {
        if (err)
            return res.json({ success: false, status: 500, msg: "DB error" });
        else if (data != undefined && data != null) {
            return res.json({ success: true, status: 200, data: data });
        } else
            return res.json({ success: false, status: 404, msg: "Not Found" });
    });
}

// get attendances for all members by classroom and date
exports.getAttendancesByClassroomAndDate = function(req, res) {
    let roomId = req.params.cid;
    let date = req.params.date;

    Attendance.find({ classroomId: roomId, date: date }, function(err, data) {
        if (err)
            return res.json({ success: false, status: 500, msg: "DB error" });
        else if (data != undefined && data != null) {
            return res.json({ success: true, status: 200, data: data });
        } else
            return res.json({ success: false, status: 404, msg: "Not Found" });
    });
}

// get attedance data by classroom, member, day
exports.getAttendanceByClassroomAndMemberAndDate = function(req, res) {
    let roomId = req.params.cid;
    let date = req.params.date;
    let accountId = req.params.sid;

    Attendance.findOne({ classroomId: roomId, accountId: accountId, date: date }, function(err, data) {
        if (err)
            return res.json({ success: false, status: 500, msg: "DB error" });
        else if (data != undefined && data != null) {
            return res.json({ success: true, status: 200, data: data });
        } else
            return res.json({ success: false, status: 404, msg: "Not Found" });
    });
}

// create attendance data
exports.createAttendance = function(req, res) {
    let { classroomId, accountId, date } = req.body;

    if (!classroomId) {
        return res.json({
            success: false,
            status: 400,
            msg: "Class room id is required"
        });
    } else if (!accountId) {
        return res.json({
            success: false,
            status: 400,
            msg: "Account id is required"
        });
    } else if (!date) {
        return res.json({
            success: false,
            status: 400,
            msg: "Date is required"
        });
    }

    let attendance = new Attendance({
        classroomId,
        accountId,
        date
    });

    attendance.save(function(err, data) {
        if (err)
            return res.json({ success: false, status: 500, msg: "DB error" });
        else if (data != undefined && data != null) {
            return res.json({ success: true, status: 200, data: data });
        } else
            return res.json({ success: false, status: 404, msg: "Not Found" });
    });
}

// update attendance present 
exports.markAttendanceList = async function(req, res) {
    // attendance list
    let attendances = req.body.attendances;

    await Promise.all(attendances.map(async(attedance) => {
        let attendanceUpdates = {};
        if (attedance.present != undefined || attedance.present != null) {
            attendanceUpdates.present = attedance.present;
        }
        Attendance.findOneAndUpdate({ _id: attedance.id }, attendanceUpdates, { new: true }, (err, doc) => {
            if (err) {
                return res.json({ success: false, status: 500, err: err.message });
            }
        });
    })).then(function(data) {
        return res.json({ success: true, status: 200 });
    });
}

// update attendance present 
exports.updateAttendance = function(req, res) {
    let attendanceUpdates = {};

    // attendance id
    let attendanceId = req.params.aid;

    /* Attendance attributes in body */
    let present = req.body.present;
    let duration = req.body.duration;

    if (present != undefined || present != null) {
        attendanceUpdates.present = present;
    }

    if (duration != undefined || duration != null) {
        attendanceUpdates.duration = duration;
    }

    Attendance.findOneAndUpdate({ _id: attendanceId }, attendanceUpdates, { new: true }, function(err, doc) {
        if (err) {
            return res.json({ success: false, status: 500, err: err.message });
        } else if (doc != undefined && doc != null) {
            return res.json({ success: true, status: 200, data: doc });
        } else {
            return res.json({ success: false, status: 404 });
        }
    });
}


// add session data
exports.addSessionToAttendance = function(req, res) {
    let { attendanceId, session } = req.body;

    if (!attendanceId) {
        return res.json({
            success: false,
            status: 400,
            msg: "Attendance id is required"
        });
    } else if (!session) {
        return res.json({
            success: false,
            status: 400,
            msg: "Session data is required"
        });
    }

    Attendance.findOne({ _id: attendanceId }, function(err, data) {
        if (err) {
            return res.json({ success: false, status: 500, msg: "DB error" });
        } else if (data != undefined && data != null) {
            let attendance = data;
            let ex_session = attendance.session[attendance.session.length - 1] // get before session

            if (ex_session != null && ex_session.activity === session.activity) {
                return res.json({ success: false, status: 500, msg: "Activity of 2 neighbour sessions must be different" });
            } else {
                if (session.activity == "JOIN") {
                    session["time"] = new Date();
                    attendance.session.push(session);
                } else {
                    if (ex_session == null) return res.json({ success: false, status: 500, msg: "Session is not started yet" });
                    else {
                        let diffTime = Math.abs(new Date() - ex_session.time)
                        session["time"] = new Date();
                        attendance.session.push(session);
                        attendance.duration += diffTime;
                    }
                }
            }

            attendance.save(function(err, doc) {
                if (err)
                    return res.json({ success: false, status: 500, msg: err });
                else if (doc != undefined && doc != null)
                    return res.json({ success: true, status: 200, data: data });
                else
                    return res.json({ success: false, status: 404, msg: "Not Found" });
            });
        } else {
            return res.json({ success: false, status: 404, msg: "Not Found" });
        }
    });
}

// A room creater end the classroom
exports.endClassroom = function(req, res) {
    let roomId = req.body.id;
    let privilege = req.body.privilege;

    if (privilege >= 99) {
        Classroom.findOne({ _id: roomId }, function(err, data) {
            if (err)
                return res.json({ success: false, status: 500, msg: "DB error" });
            else if (data != undefined && data != null) {
                if (data.roomSID != undefined && data.roomSID != null) {
                    twClient.rooms(data.roomSID)
                        .fetch()
                        .then(room => {
                            if (room.status == "completed") { // decide current is completed or not
                                Classroom.remove({ _id: roomId }, function(err, data) {
                                    if (err)
                                        return res.json({ success: false, status: 500, msg: "DB error" });
                                    else if (data != undefined && data != null) {
                                        return res.json({ success: true, status: 200, msg: "Successfully ended" });
                                    } else
                                        return res.json({ success: false, status: 404, msg: "Not Found" });
                                });
                            } else {
                                twClient.rooms(data.roomSID)
                                    .update({ status: "completed" }) // complete the room
                                    .then(room => {
                                        return res.json({ success: true, status: 200, msg: "Successfully ended" });
                                    })
                                    .catch(message => {
                                        console.log(message)
                                        res.json({ success: false, status: 400, msg: message })
                                    });
                            }
                        })
                        .catch(message => {
                            console.log(message)
                            res.json({ success: false, status: 400, msg: message })
                        });
                } else {
                    Classroom.remove({ _id: roomId }, function(err, data) {
                        if (err)
                            return res.json({ success: false, status: 500, msg: "DB error" });
                        else if (data != undefined && data != null) {
                            return res.json({ success: true, status: 200, msg: "Successfully ended" });
                        } else
                            return res.json({ success: false, status: 404, msg: "Not Found" });
                    });
                }
            } else
                return res.json({ success: false, status: 404, msg: "Not Found" });
        });
    } else {
        return res.json({ success: false, status: 403, msg: "You are not a Administrator" });
    }
}

// add student to the classroom
exports.addStudents = function(req, res) {
    let classroomId = req.params.cid;
    let studentList = req.body.slist;

    Classroom.findOne({ _id: classroomId }, function(err, data) { // finding the room
        if (err) {
            return res.json({ success: false, status: 500, msg: "DB error" });
        } else if (data != undefined && data != null) {
            let classroom = data;
            studentList.forEach(student => {
                let filteredArry = classroom.members.filter(member => {
                    return member.accountId == student.accountId
                })
                if (filteredArry.length == 0) {
                    classroom.members.push({
                        accountId: student.accountId,
                        finalGrade: 0
                    })
                }
            })
            classroom.save(function(err, doc) {
                if (err)
                    return res.json({ success: false, status: 500, msg: "DB error" });
                else if (doc != undefined && doc != null)
                    return res.json({ success: true, status: 200, data: data });
                else
                    return res.json({ success: false, status: 404, msg: "Not Found" });
            });
        } else {
            return res.json({ success: false, status: 404, msg: "Not Found" });
        }
    });
}

// remove student from the classroom
exports.removeStudents = function(req, res) {
    let classroomId = req.params.cid;
    let studentList = req.body.slist;

    Classroom.findOne({ _id: classroomId }, function(err, data) { // finding the room
        if (err) {
            return res.json({ success: false, status: 500, msg: err });
        } else if (data != undefined && data != null) {
            let classroom = data;

            studentList.forEach(student => {
                let filteredArry = classroom.members.filter(member => {
                    return member.accountId == student.accountId
                })

                if (filteredArry.length !== 0) {
                    classroom.members = classroom.members.filter(m => {
                        return m.accountId !== student.accountId
                    })
                }
            })

            classroom.save(function(err, doc) {
                if (err)
                    return res.json({ success: false, status: 500, msg: "DB error" });
                else if (doc != undefined && doc != null)
                    return res.json({ success: true, status: 200, data: data });
                else
                    return res.json({ success: false, status: 404, msg: "Not Found" });
            });
        } else {
            return res.json({ success: false, status: 404, msg: "Not Found" });
        }
    });
}

// get recording by participants Id
exports.getAllRecordingsByPId = function(req, res) {
    pId = req.params.pid;
    twClient.recordings.list({ groupingSid: [pId], limit: 20 }) // recordings list
        .then(recordings => {
            console.log(recordings);
            return res.json({ success: true, status: 200, data: recordings });
        })
        .catch(err => {
            console.log(err)
            return res.json({ success: false, status: 400, msg: "Recording not exist." })
        })
}

// get the composition complete recording in a grid
exports.createCompositionOfRecording = function(req, res) {
    const Twilio = require('twilio');
    const client = new Twilio(twilioApiKey, twilioApiSecret, { accountSid: accountSid });
    let classroomId = req.params.id;
    let participantId = req.params.pid;

    client.video.compositions.
    create({
            roomSid: classroomId,
            audioSources: '*', // all the audio from all the participants
            videoLayout: {
                single: {
                    video_sources: [participantId] // video of current participant
                }
            },
            statusCallback: `https://${req.headers.host}/classroom/${webhookCompositionCallbackUrl}`, //  call back for the composition processing event
            format: 'mp4' // media type
        })
        .then(composition => {
            console.log('Created Composition with SID=' + composition.sid);
            return res.json({ success: true, data: composition, status: 200 });
        })
        .catch(message => {
            console.log("Error", message)
            return res.json({ success: false, status: 401, msg: "Composition Creation Failed" });
        });
}

// getting composed media
exports.getComposedMedia = function(req, res) {
    const Twilio = require('twilio');
    const client = new Twilio(twilioApiKey, twilioApiSecret, { accountSid: accountSid });

    const uri = 'https://video.twilio.com/v1/Compositions/' + req.params.id + '/Media?Ttl=3600'; // media absoulte uri
    client.request({
            method: 'GET',
            uri: uri
        })
        .then(response => {
            const mediaLocation = JSON.parse(response.body).redirect_to;
            console.log(mediaLocation)
            return res.json({ success: true, status: 200, location: mediaLocation });
        })
        .catch(error => {
            console.log("Error" + error);
            res.json({ success: false, status: 400, msg: "Composition not exist" });
        });
}


// callbacks for the room event
exports.roomCallback = function(req, res) {
    if (req.body.StatusCallbackEvent != undefined) {
        if (req.body.StatusCallbackEvent == "room-ended") { // room-ended callback
            console.log("room-ended");
            // Classroom.remove({ roomSID: req.body.RoomSid }, function(err, data) {});
            // tw.chat.services(serviceId)
            //     .channels
            //     .list({ uniqueName: req.body.RoomSid })
            //     .then(channels => {
            //         console.log("KOK", channels[0]);
            //         channels[0].remove();
            //     })
        }
        if (req.body.StatusCallbackEvent == "room-created") { // room-created callback
            console.log("room-created")
        }
        if (req.body.StatusCallbackEvent == "participant-connected") { // participant-connected callback
            console.log("participant-connected")
        }
        if (req.body.StatusCallbackEvent == "participant-disconnected") { // participant-disconnected callback
            console.log(req.body)
        }
        if (req.body.StatusCallbackEvent == "track-added") { // track-added callback
            console.log("track-added")
        }
        if (req.body.StatusCallbackEvent == "track-removed") { // track-removed callback
            console.log("track-removed")
        }
        if (req.body.StatusCallbackEvent == "track-enabled") { // track-enabled callback
            console.log("track-enabled")
        }
        if (req.body.StatusCallbackEvent == "track-disabled") { // track-disabled callback                               
            console.log("track-disabled")
        }
        if (req.body.StatusCallbackEvent == "recording-started") { // recording-started callback
            console.log("recording-started")
        }
        if (req.body.StatusCallbackEvent == "recording-completed") { // recording-completed callback
            console.log("recording-completed")
        }
        if (req.body.StatusCallbackEvent == "recording-failed") { // recording-failed callback
            console.log("recording-failed")
        }
        return res.json({ success: true });
    } else {
        return res.json({ success: false });
    }
}

// the call back for the composition event
exports.compositionCallback = function(req, res) {
    if (req.body.StatusCallbackEvent != undefined) {
        if (req.body.StatusCallbackEvent == "composition-enqueued") { // composition-enqueued callback
        }
        if (req.body.StatusCallbackEvent == "composition-hook-failed") { // composition-hook-failed callback
        }
        if (req.body.StatusCallbackEvent == "composition-started") { // composition-started callback
            console.log("composition-started")
        }
        if (req.body.StatusCallbackEvent == "composition-available") { // composition-available callback
            return res.json({ mediaUri: "video.twilio.com" + req.body.CompositionUri + "/Media" });
        }
        if (req.body.StatusCallbackEvent == "composition-progress") { // composition-progress callback
            console.log("composition-progress")
        }
        if (req.body.StatusCallbackEvent == "composition-failed") { // composition-failed callback
            console.log("composition-failed")
        }
        return res.json({ success: true });
    } else {
        return res.json({ success: false });
    }
}

// generate token for the specified user and room
exports.generateAccessToken = function(req, res) {
    const VideoGrant = AccessToken.VideoGrant;
    const identity = req.account._id;
    const roomName = req.params.roomName;
    const universityId = req.params.universityId;

    // Create Video Grant
    const videoGrant = new VideoGrant({});

    // Create an access token which we will sign and return to the client,
    // containing the grant we just created
    const token = new AccessToken(accountSid, twilioApiKey, twilioApiSecret);
    token.addGrant(videoGrant);
    token.identity = identity;

    // Serialize the token to a JWT string
    let jwt = token.toJwt();
    return res.json({ success: true, token: jwt });
}

// exports.donate = function(req, res) {
//     let classroomId = req.params.id;
//     let accountId = req.account._id;

//     let donation = new Donation();
//     donation.classroomId = classroomId;
//     donation.accountId = accountId;

//     donation.save(function(err, doc) {
//         if (err) {
//             return res.json({ success: false, status: 140, err: err });
//         } else if (doc != undefined && doc != null) {
//             return res.json({ success: true, status: 141 });
//         } else {
//             return res.json({ success: false, status: 142 });
//         }
//     });
// }

exports.getAllParticipants = function(req, res) {
    let roomId = req.params.cid;
    return twClient.rooms(roomId).participants
        .list()
        .then((participants) => {
            console.log(participants)
            return res.json({ success: true, status: 200, data: participants })
        }).catch(err => {
            return res.json({ success: true, status: 400, msg: 'failed' })
        })
}

exports.subscribeAll = function(req, res) {
    let roomId = req.body.id;
    let pId = req.body.pid;
    twClient.rooms(roomId).participants.get(pId)
        .subscribeRules.update({
            rules: [
                { "type": "include", "all": true }
            ]
        })
        .then(result => {
            return res.json({ success: true, status: 200, msg: "subscribed" });
        })
        .catch(error => {
            return res.json({ success: falsse, status: 400, msg: 'subscription failed' })
        });
}